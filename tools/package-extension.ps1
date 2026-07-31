[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$srcRoot = Join-Path $repoRoot 'src'
$manifestPath = Join-Path $srcRoot 'manifest.json'
$validatorPath = Join-Path $PSScriptRoot 'validate-extension.js'
$distRoot = Join-Path $repoRoot 'dist'

if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
  throw "Extension manifest not found: $manifestPath"
}

& node $validatorPath
if ($LASTEXITCODE -ne 0) {
  throw "Extension validation failed with exit code $LASTEXITCODE."
}

$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if (-not $manifest.version) {
  throw 'Extension manifest version is missing.'
}

New-Item -ItemType Directory -Path $distRoot -Force | Out-Null

$packageName = "arca-image-downloader-v$($manifest.version).zip"
$packagePath = Join-Path $distRoot $packageName
$resolvedDist = [System.IO.Path]::GetFullPath($distRoot).TrimEnd(
  [System.IO.Path]::DirectorySeparatorChar
)
$targetParent = [System.IO.Path]::GetDirectoryName(
  [System.IO.Path]::GetFullPath($packagePath)
).TrimEnd([System.IO.Path]::DirectorySeparatorChar)

if (-not $targetParent.Equals(
  $resolvedDist,
  [System.StringComparison]::OrdinalIgnoreCase
)) {
  throw "Refusing to write package outside dist: $packagePath"
}

if (Test-Path -LiteralPath $packagePath -PathType Leaf) {
  Remove-Item -LiteralPath $packagePath -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$sourceFiles = @(
  Get-ChildItem -LiteralPath $srcRoot -Recurse -File |
    Sort-Object FullName
)

if ($sourceFiles.Count -eq 0) {
  throw 'No extension files found under src.'
}

$archive = [System.IO.Compression.ZipFile]::Open(
  $packagePath,
  [System.IO.Compression.ZipArchiveMode]::Create
)
try {
  foreach ($file in $sourceFiles) {
    $entryName = [System.IO.Path]::GetRelativePath(
      $srcRoot,
      $file.FullName
    ).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive,
      $file.FullName,
      $entryName,
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
}
finally {
  $archive.Dispose()
}

$archive = [System.IO.Compression.ZipFile]::OpenRead($packagePath)
try {
  $entryNames = @($archive.Entries | ForEach-Object FullName)
  if ($entryNames -notcontains 'manifest.json') {
    throw 'manifest.json is not at the package root.'
  }

  $repositoryOnlyEntries = @(
    $entryNames | Where-Object {
      $_ -match '^(src/|README\.md$|\.vscode/|\.agents/|\.github/|tools/|docs/)'
    }
  )
  if ($repositoryOnlyEntries.Count -gt 0) {
    throw "Repository-only content found in package: $($repositoryOnlyEntries -join ', ')"
  }

  $expectedNames = @(
    $sourceFiles | ForEach-Object {
      [System.IO.Path]::GetRelativePath($srcRoot, $_.FullName).Replace('\', '/')
    }
  )
  $missingEntries = @($expectedNames | Where-Object { $_ -notin $entryNames })
  if ($missingEntries.Count -gt 0) {
    throw "Source files missing from package: $($missingEntries -join ', ')"
  }
}
finally {
  $archive.Dispose()
}

Write-Output "Extension package: $([System.IO.Path]::GetFullPath($packagePath))"
