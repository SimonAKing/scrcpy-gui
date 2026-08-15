$ErrorActionPreference = 'Stop'

$packageName = 'scrcpy-gui'
$softwareName = 'Scrcpy GUI*'
$registryKeys = Get-UninstallRegistryKey -SoftwareName $softwareName

if ($registryKeys.Count -eq 0) {
  Write-Warning "$softwareName is not registered as installed."
  return
}

foreach ($registryKey in $registryKeys) {
  if (-not $registryKey.UninstallString) { continue }
  $uninstaller = $registryKey.UninstallString.Trim('"')
  Uninstall-ChocolateyPackage -PackageName $packageName -FileType 'exe' -SilentArgs '/S /allusers' -File $uninstaller -ValidExitCodes @(0)
}
