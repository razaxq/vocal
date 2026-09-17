# Convert the existing project logo into the bitmaps required by NSIS MUI.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
$logo = [Drawing.Image]::FromFile("$repo/resources/icon.png")
try {
    foreach ($art in @(
        @{ Name='header'; Width=150; Height=57; X=100; Y=8; Size=40 }
    )) {
        $bitmap = [Drawing.Bitmap]::new($art.Width, $art.Height, [Drawing.Imaging.PixelFormat]::Format24bppRgb)
        $canvas = [Drawing.Graphics]::FromImage($bitmap)
        try {
            $canvas.Clear([Drawing.Color]::White)
            $canvas.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $canvas.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $canvas.DrawImage($logo, [Drawing.Rectangle]::new($art.X, $art.Y, $art.Size, $art.Size))
            $bitmap.Save("$repo/native/installer/$($art.Name).bmp", [Drawing.Imaging.ImageFormat]::Bmp)
        } finally {
            $canvas.Dispose()
            $bitmap.Dispose()
        }
    }
} finally { $logo.Dispose() }
