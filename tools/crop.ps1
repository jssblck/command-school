# Crops and magnifies a region of a shot, so an artifact can be looked at instead
# of guessed at. Usage: crop.ps1 <png> <x> <y> <w> <h> [zoom]
param(
  [Parameter(Mandatory)][string]$Path,
  [Parameter(Mandatory)][int]$X,
  [Parameter(Mandatory)][int]$Y,
  [Parameter(Mandatory)][int]$W,
  [Parameter(Mandatory)][int]$H,
  [int]$Zoom = 4
)
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile((Resolve-Path $Path))
$out = New-Object System.Drawing.Bitmap ($W * $Zoom), ($H * $Zoom)
$g = [System.Drawing.Graphics]::FromImage($out)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
$g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, ($W * $Zoom), ($H * $Zoom)), (New-Object System.Drawing.Rectangle $X, $Y, $W, $H), [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$dest = Join-Path (Split-Path (Resolve-Path $Path)) 'crop.png'
$out.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
$out.Dispose(); $src.Dispose()
Write-Output $dest
