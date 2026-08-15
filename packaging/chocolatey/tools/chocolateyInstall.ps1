$ErrorActionPreference = 'Stop'

$packageName = 'scrcpy-gui'
$version = $env:ChocolateyPackageVersion
$url64 = "https://github.com/SimonAKing/scrcpy-gui/releases/download/v$version/Scrcpy.GUI-$version-win-x64.exe"
$checksum64 = 'c6ad3af3083a54843c2c404d48b3b0e86f5f23e582bfe98b55a5124622678549'

$packageArgs = @{
  packageName = $packageName
  fileType = 'exe'
  url64bit = $url64
  checksum64 = $checksum64
  checksumType64 = 'sha256'
  silentArgs = '/S /allusers'
  validExitCodes = @(0)
}

Install-ChocolateyPackage @packageArgs
