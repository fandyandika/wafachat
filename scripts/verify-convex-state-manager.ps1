param(
  [switch] $RunSetOrder
)

$ErrorActionPreference = 'Stop'

$envPath = Join-Path $PSScriptRoot '..\.env.local'
$stateManagerUrl = (Get-Content -Path $envPath |
  Where-Object { $_ -like 'N8N_STATE_MANAGER_URL=*' } |
  Select-Object -First 1).Substring('N8N_STATE_MANAGER_URL='.Length).Trim('"')

function Invoke-StateManager {
  param([hashtable] $Body)

  Invoke-RestMethod `
    -Method Post `
    -Uri $stateManagerUrl `
    -ContentType 'application/json' `
    -Body ($Body | ConvertTo-Json -Compress -Depth 10) `
    -TimeoutSec 20
}

$results = [ordered]@{
  health = Invoke-StateManager -Body @{ action = 'health' }
  stats = Invoke-StateManager -Body @{ action = 'get_stats' }
  list = Invoke-StateManager -Body @{ action = 'list_all'; includeClosed = $true }
  context = Invoke-StateManager -Body @{ action = 'get_with_global'; phone = '6280000000000' }
}

if ($RunSetOrder) {
  $testOrderId = 'VERIFY-CONVEX-' + (Get-Date -Format 'yyyyMMddHHmmss')
  $results.set_order = Invoke-StateManager -Body @{
    action = 'set_order'
    phone = '6280000000999'
    csName = 'CS Aisyah'
    productName = 'Convex Verification Product'
    products = 'Convex Verification Product (1x)'
    productsSubtotal = 'Rp0'
    shippingCost = 'Rp0'
    total = 'Rp0'
    customerName = 'Convex Verify'
    shippingAddress = 'Verification Address'
    shippingDistrict = 'Verification District'
    shippingCity = 'Verification City'
    order_id = $testOrderId
  }
  $results.after_set_order_stats = Invoke-StateManager -Body @{ action = 'get_stats' }
}

$results | ConvertTo-Json -Depth 20
