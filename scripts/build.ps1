$ErrorActionPreference = 'Stop'
python (Join-Path $PSScriptRoot 'build.py')
if ($LASTEXITCODE -ne 0) { throw 'XPI build failed' }
