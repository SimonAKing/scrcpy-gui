param(
  [Parameter(Mandatory = $true)]
  [string]$Destination,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedRoot
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression

$destinationRoot = [System.IO.Path]::GetFullPath($Destination)
$trimCharacters = [char[]]@([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
$destinationPrefix = $destinationRoot.TrimEnd($trimCharacters) + [System.IO.Path]::DirectorySeparatorChar
[System.IO.Directory]::CreateDirectory($destinationRoot) | Out-Null

$archiveBytes = [System.IO.MemoryStream]::new()
$archive = $null
try {
  [Console]::OpenStandardInput().CopyTo($archiveBytes)
  if ($archiveBytes.Length -eq 0 -or $archiveBytes.Length -gt 128MB) {
    throw 'Verified ZIP input must be between 1 byte and 128 MiB.'
  }
  $archiveBytes.Position = 0
  $archive = [System.IO.Compression.ZipArchive]::new(
    $archiveBytes,
    [System.IO.Compression.ZipArchiveMode]::Read,
    $false
  )

  $prefix = "$ExpectedRoot/"
  $fileCount = 0
  $totalBytes = [long]0
  foreach ($entry in $archive.Entries) {
    if ($entry.FullName -eq $prefix) { continue }
    if (-not $entry.FullName.StartsWith($prefix, [System.StringComparison]::Ordinal)) {
      throw "ZIP entry is outside the expected root: $($entry.FullName)"
    }

    $relative = $entry.FullName.Substring($prefix.Length)
    if ([string]::IsNullOrEmpty($relative)) { continue }
    if ($relative.Contains('\') -or $relative.Contains(':') -or $relative -match '(^|/)\.\.?(/|$)') {
      throw "ZIP entry has an unsafe path: $($entry.FullName)"
    }

    $target = [System.IO.Path]::GetFullPath(
      [System.IO.Path]::Combine($destinationRoot, $relative.Replace('/', [System.IO.Path]::DirectorySeparatorChar))
    )
    if (-not $target.StartsWith($destinationPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "ZIP entry escapes the destination: $($entry.FullName)"
    }

    if ($entry.FullName.EndsWith('/')) {
      [System.IO.Directory]::CreateDirectory($target) | Out-Null
      continue
    }

    $fileCount += 1
    $totalBytes += $entry.Length
    if ($fileCount -gt 1000 -or $totalBytes -gt 512MB) {
      throw 'ZIP contents exceed the extraction limits.'
    }

    [System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($target)) | Out-Null
    $entryStream = $entry.Open()
    $output = [System.IO.File]::Open($target, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
      $entryStream.CopyTo($output)
    } finally {
      $output.Dispose()
      $entryStream.Dispose()
    }
  }

  if ($fileCount -eq 0) { throw 'Verified ZIP contained no files.' }
} finally {
  if ($null -ne $archive) { $archive.Dispose() }
  $archiveBytes.Dispose()
}
