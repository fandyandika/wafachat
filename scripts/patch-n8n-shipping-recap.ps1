$ErrorActionPreference = 'Stop'

$workflowId = '4eBFqyabDlIRx3ZY'
$nodeName = '09 Parse AI Reply + Save History'
$date = Get-Date -Format 'yyyy-MM-dd'
$timestamp = Get-Date -Format 'HHmmss'
$backupDir = Join-Path 'docs/n8n-backups' $date
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$mcpConfig = Get-Content -Raw -Path 'F:\Projects\n8n\.mcp.json' | ConvertFrom-Json
$server = $mcpConfig.mcpServers.'n8n-mcp'
$baseUrl = $server.env.N8N_API_URL.TrimEnd('/')
$headers = @{
  'X-N8N-API-KEY' = $server.env.N8N_API_KEY
  'Content-Type' = 'application/json'
}

function Clean-WorkflowForUpdate {
  param([object] $Workflow)

  $allowedSettings = @(
    'saveExecutionProgress',
    'saveManualExecutions',
    'saveDataErrorExecution',
    'saveDataSuccessExecution',
    'executionTimeout',
    'errorWorkflow',
    'timezone',
    'executionOrder',
    'callerPolicy',
    'callerIds',
    'timeSavedPerExecution',
    'availableInMCP'
  )

  $settings = [ordered]@{}
  if ($Workflow.settings) {
    foreach ($name in $allowedSettings) {
      if ($Workflow.settings.PSObject.Properties.Name -contains $name) {
        $settings[$name] = $Workflow.settings.$name
      }
    }
  }
  if ($settings.Count -eq 0) {
    $settings['executionOrder'] = 'v1'
  }

  [ordered]@{
    name = $Workflow.name
    nodes = $Workflow.nodes
    connections = $Workflow.connections
    settings = $settings
  }
}

$workflow = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/v1/workflows/$workflowId" -Headers $headers
$backupPath = Join-Path $backupDir "chat-handler.pre-shipping-recap-$timestamp.json"
$workflow | ConvertTo-Json -Depth 100 | Set-Content -Path $backupPath -Encoding UTF8

$node = $workflow.nodes | Where-Object { $_.name -eq $nodeName } | Select-Object -First 1
if (-not $node) {
  throw "Node not found: $nodeName"
}

$code = [string] $node.parameters.jsCode
if ($code -notmatch 'upsert_shipping_recap') {
  $insert = @'

if (isClosing && replyText && replyText.includes('PEMESANAN BERHASIL')) {
  try {
    await this.helpers.httpRequest({
      method: 'POST',
      url: 'https://n8n.miqra.dev/webhook/conversation-state',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'upsert_shipping_recap',
        phone,
        order_id: parseState.order_id || '',
        customerName: parseState.customerName || inbound.customerName || '',
        csName: parseState.csName || inbound.csName || 'CS Aisyah',
        csNumber: parseState.csNumber || inbound.csNumber || '',
        sourceMessageId: inbound.messageId || inbound.externalMessageId || '',
        sourceMessageText: replyText,
        closedAt: Date.now(),
      }),
      json: true,
    });
  } catch (error) {
    // Recap export must not block WhatsApp reply delivery.
  }
}
'@

  $marker = "return [{ json: { phone, replyText, isHandover, handoverReason, rawAiOutput: aiOutput, isClosing, orderMethod, bonusItem, instruksiPengiriman } }];"
  if (-not $code.Contains($marker)) {
    throw 'Return marker not found; aborting patch.'
  }
  $node.parameters.jsCode = $code.Replace($marker, "$insert`n$marker")
}

$payload = Clean-WorkflowForUpdate -Workflow $workflow
$json = $payload | ConvertTo-Json -Depth 100
Invoke-RestMethod -Method Put -Uri "$baseUrl/api/v1/workflows/$workflowId" -Headers $headers -Body $json | Out-Null

$updated = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/v1/workflows/$workflowId" -Headers $headers
$postPath = Join-Path $backupDir "chat-handler.post-shipping-recap-$timestamp.json"
$updated | ConvertTo-Json -Depth 100 | Set-Content -Path $postPath -Encoding UTF8

Write-Output "Patched workflow $workflowId"
Write-Output "Backup: $backupPath"
Write-Output "Post: $postPath"
