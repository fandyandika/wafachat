param(
  [Parameter(Mandatory = $true)]
  [string]$CsvPath,

  [string]$ImportBatchId = "berdu-" + (Get-Date -Format "yyyyMMdd-HHmmss"),

  [int]$BatchSize = 10,

  [string]$AdapterUrl = "https://helpful-spoonbill-863.convex.site/n8n/state",

  [string]$AdapterSecret = ""
)

$ErrorActionPreference = "Stop"

function Normalize-Phone([string]$Value) {
  $digits = ($Value -replace '\D', '')
  if ($digits.StartsWith('0')) {
    return '62' + $digits.Substring(1)
  }
  return $digits
}

function Normalize-OrderId([string]$Value) {
  $text = ([string]$Value).Trim()
  if (-not $text) { return "" }
  if ($text.StartsWith("O-")) { return $text }
  return "O-$text"
}

function Parse-Number($Value) {
  $text = ([string]$Value).Trim()
  if (-not $text) { return $null }
  $digits = $text -replace '[^\d-]', ''
  if (-not $digits) { return $null }
  return [int]$digits
}

function Parse-BerduDate([string]$Value) {
  $text = ([string]$Value).Trim()
  $formats = @('dd/MM/yyyy h:mm tt', 'dd/MM/yyyy hh:mm tt', 'd/M/yyyy h:mm tt', 'd/M/yyyy hh:mm tt')
  foreach ($format in $formats) {
    try {
      $date = [DateTime]::ParseExact($text, $format, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeLocal)
      return ([DateTimeOffset]$date).ToUnixTimeMilliseconds()
    } catch {}
  }
  return ([DateTimeOffset]([DateTime]::Parse($text))).ToUnixTimeMilliseconds()
}

function Payment-Method([string]$Value) {
  $text = ([string]$Value).ToLowerInvariant()
  if ($text -match 'tempat|cod') { return 'cod' }
  if ($text -match 'transfer|bank') { return 'transfer' }
  return 'unknown'
}

function Remove-NullProperties($Value) {
  if ($null -eq $Value) { return $null }
  if ($Value -is [System.Collections.IEnumerable] -and $Value -isnot [string] -and $Value -isnot [hashtable] -and $Value -isnot [pscustomobject]) {
    return @($Value | ForEach-Object { Remove-NullProperties $_ })
  }

  $result = [ordered]@{}
  foreach ($property in $Value.PSObject.Properties) {
    if ($null -ne $property.Value) {
      $result[$property.Name] = $property.Value
    }
  }
  return [pscustomobject]$result
}

if (-not (Test-Path -LiteralPath $CsvPath)) {
  throw "CSV not found: $CsvPath"
}

$raw = Get-Content -Raw -LiteralPath $CsvPath
$csvText = $raw -replace '^sep=,\r?\n', ''
$csvRows = @($csvText | ConvertFrom-Csv)
$rows = New-Object System.Collections.Generic.List[object]
$last = $null

foreach ($row in $csvRows) {
  $nomor = ([string]$row.Nomor).Trim()
  $orderId = Normalize-OrderId $row.'Order Id'

  if ($nomor -and $orderId) {
    $timestamp = Parse-BerduDate $row.'Waktu Dibuat'
    $itemPrice = Parse-Number $row.'Harga Produk'
    $shippingCost = Parse-Number $row.'Tarif Pengiriman'
    $total = Parse-Number $row.Total
    $phone = Normalize-Phone $row.'Telepon (Alamat)'
    $addressParts = @($row.Alamat, $row.Kecamatan, $row.'Kota/Kabupaten', $row.Provinsi, $row.'Kode Pos') |
      Where-Object { ([string]$_).Trim() } |
      ForEach-Object { ([string]$_).Trim() }

    $entry = [pscustomobject][ordered]@{
      orderIdBerdu = $orderId
      customerName = ([string]$row.'Nama Depan').Trim()
      customerPhone = $phone
      csName = ([string]$row.'Ditugaskan Ke').Trim()
      orderedAt = $timestamp
      closedAt = $timestamp
      recipientName = ([string]$row.'Nama Depan').Trim()
      recipientPhone = $phone
      recipientAddress = ($addressParts -join ', ')
      recipientDistrict = ([string]$row.Kecamatan).Trim()
      recipientCity = ([string]$row.'Kota/Kabupaten').Trim()
      packageContent = (@($row.'Nama Produk', $row.'Variasi Produk') | Where-Object { ([string]$_).Trim() } | ForEach-Object { ([string]$_).Trim() }) -join ' - '
      paymentMethod = Payment-Method $row.'Metode Pembayaran'
      itemPrice = $itemPrice
      shippingCost = $shippingCost
      total = $total
      discount = $null
      sourceMessageText = "BERDU VERIFIED CLOSING`nOrder Id: $orderId`nNama: $(([string]$row.'Nama Depan').Trim())`nPhone: $phone`nProduk: $(([string]$row.'Nama Produk').Trim())`nTotal: $total`nPayment: $(([string]$row.'Metode Pembayaran').Trim())`nAlamat: $(($addressParts -join ', '))`nCatatan: $(([string]$row.'Catatan Admin').Trim())"
    }
    $rows.Add($entry) | Out-Null
    $last = $entry
    continue
  }

  $adjustmentName = ([string]$row.'Nama Produk').Trim()
  if ($last -and $adjustmentName -match 'Ubah Total') {
    $amount = Parse-Number $row.'Harga Produk'
    if ($amount -lt 0) {
      $last.discount = [Math]::Abs($amount)
      $last.sourceMessageText = "$($last.sourceMessageText)`nDiskon/Ubah Total: $amount"
    }
  }
}

if ($rows.Count -eq 0) {
  throw "No Berdu order rows found in $CsvPath"
}

$batches = [Math]::Ceiling($rows.Count / $BatchSize)
$summary = @()
$envPath = Join-Path (Get-Location) ".env.local"
$adapterSecret = $AdapterSecret
if (Test-Path -LiteralPath $envPath) {
  $secretLine = Get-Content -LiteralPath $envPath | Where-Object { $_ -match '^N8N_CONVEX_ADAPTER_SECRET=' } | Select-Object -First 1
  if (-not $adapterSecret -and $secretLine) {
    $adapterSecret = ($secretLine -replace '^N8N_CONVEX_ADAPTER_SECRET=', '').Trim('"').Trim("'")
  }
}

$headers = @{ "Content-Type" = "application/json" }
if ($adapterSecret) {
  $headers["x-wafachat-adapter-secret"] = $adapterSecret
}

for ($i = 0; $i -lt $rows.Count; $i += $BatchSize) {
  $batchRows = @($rows | Select-Object -Skip $i -First $BatchSize | ForEach-Object { Remove-NullProperties $_ })
  $payloadObject = @{
    action = "import_berdu_verified_rows"
    importBatchId = $ImportBatchId
    rows = $batchRows
  }
  $payload = $payloadObject | ConvertTo-Json -Depth 8 -Compress
  $result = Invoke-RestMethod -Method Post -Uri $AdapterUrl -Headers $headers -Body $payload
  $summary += $result
}

[pscustomobject]@{
  success = $true
  importBatchId = $ImportBatchId
  rows = $rows.Count
  batches = $batches
  results = $summary
} | ConvertTo-Json -Depth 6
