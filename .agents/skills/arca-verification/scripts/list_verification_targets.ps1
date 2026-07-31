param(
  [string]$RepoRoot = (Get-Location).Path
)

$resolvedRoot = (Resolve-Path $RepoRoot).Path

$requiredTargets = @(
  'src/manifest.json',
  'src/shared/media-utils.js',
  'src/content/content.js',
  'src/content/twitter-resolver.js',
  'src/content/content-ui.js',
  'src/background/twitter-api.js',
  'src/background/background.js',
  'tools/validate-extension.js',
  'tools/test-validate-extension.js',
  'tools/test-media-utils.js',
  'tools/test-twitter-api.js',
  'README.md',
  'AGENTS.md',
  'PRIVACY_POLICY.md'
)

Write-Output "Repo root: $resolvedRoot"
Write-Output ''
Write-Output 'Required verification targets:'

$missingCount = 0
foreach ($relativePath in $requiredTargets) {
  $fullPath = Join-Path $resolvedRoot $relativePath
  if (Test-Path -LiteralPath $fullPath -PathType Leaf) {
    Write-Output "[OK] $relativePath"
  }
  else {
    Write-Output "[MISSING] $relativePath"
    $missingCount += 1
  }
}

Write-Output ''
Write-Output 'Verification reminders:'
Write-Output '- Run the Node validator and synthetic tests.'
Write-Output '- Keep manifest permissions, privacy text, README, and AGENTS aligned.'
Write-Output '- State whether browser execution and package inspection were completed.'

if ($missingCount -gt 0) {
  Write-Error "$missingCount required verification target(s) are missing."
  exit 1
}

Write-Output ''
Write-Output 'Verification target check: PASS'
