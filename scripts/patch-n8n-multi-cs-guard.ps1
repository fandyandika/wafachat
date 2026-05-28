$ErrorActionPreference = 'Stop'

$workflowId = '4eBFqyabDlIRx3ZY'
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
$backupPath = Join-Path $backupDir "chat-handler.pre-multi-cs-$timestamp.json"
$workflow | ConvertTo-Json -Depth 100 | Set-Content -Path $backupPath -Encoding UTF8

$manualNode = $workflow.nodes | Where-Object { $_.name -eq '02 Parse Message + Manual CS Guard' } | Select-Object -First 1
if (-not $manualNode) {
  throw 'Node not found: 02 Parse Message + Manual CS Guard'
}

$manualCode = [string] $manualNode.parameters.jsCode
$manualOld = @'
  const csName = stateResp.csName || '';
  const normalizedCsName = csName.toString().toLowerCase().replace(/[^a-z]/g, '');
  const isAisyah = normalizedCsName.includes('aisyah');
  const hasOrderState = Boolean(stateResp.order_id || stateResp.productName || stateResp.csName);
  if (!isAisyah || !hasOrderState) return;
'@
$manualNew = @'
  const hasOrderState = Boolean(stateResp.order_id || stateResp.productName || stateResp.csName);
  const reportingEnabled = stateResp.reportingEnabled !== false;
  if (!reportingEnabled || !hasOrderState) return;
'@

if ($manualCode.Contains($manualOld)) {
  $manualNode.parameters.jsCode = $manualCode.Replace($manualOld, $manualNew)
}

$validateNode = $workflow.nodes | Where-Object { $_.name -eq '04 Validate AI Scope + State' } | Select-Object -First 1
if (-not $validateNode) {
  throw 'Node not found: 04 Validate AI Scope + State'
}

$validateCode = [string] $validateNode.parameters.jsCode
$validateCode = $validateCode.Replace(
@'
const normalizedCsName = csName.toString().toLowerCase().replace(/[^a-z]/g, '');
const isAisyah = normalizedCsName.includes('aisyah');
const hasOrderState = Boolean(stateResp.order_id || stateResp.productName || stateResp.csName);
'@,
@'
const aiEnabled = stateResp.aiEnabled === true;
const canAiReply = stateResp.canAiReply === true;
const hasOrderState = Boolean(stateResp.order_id || stateResp.productName || stateResp.csName);
'@
)
$validateCode = $validateCode.Replace(
@'
if (isAisyah && hasOrderState && p.messageText) {
'@,
@'
if (hasOrderState && p.messageText) {
'@
)
$validateCode = $validateCode.Replace(
@'
} else if (!isAisyah) {
  aiBlockReason = `not_cs_aisyah:${csName || 'blank'}`;
} else if (customerStatus !== 'active') {
'@,
@'
} else if (!aiEnabled) {
  aiBlockReason = `ai_disabled_for_cs:${csName || 'blank'}`;
} else if (!canAiReply || customerStatus !== 'active') {
'@
)
$validateCode = $validateCode.Replace('isAllowedCs: isAisyah,', 'isAllowedCs: aiEnabled,')
$validateCode = $validateCode.Replace('conversationStatus,', 'conversationStatus,`n  aiEnabled,`n  canAiReply,')
$validateNode.parameters.jsCode = $validateCode

$payload = Clean-WorkflowForUpdate -Workflow $workflow
$json = $payload | ConvertTo-Json -Depth 100
Invoke-RestMethod -Method Put -Uri "$baseUrl/api/v1/workflows/$workflowId" -Headers $headers -Body $json | Out-Null

$updated = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/v1/workflows/$workflowId" -Headers $headers
$postPath = Join-Path $backupDir "chat-handler.post-multi-cs-$timestamp.json"
$updated | ConvertTo-Json -Depth 100 | Set-Content -Path $postPath -Encoding UTF8

Write-Output "Patched workflow $workflowId for multi-CS AI guard"
Write-Output "Backup: $backupPath"
Write-Output "Post: $postPath"
