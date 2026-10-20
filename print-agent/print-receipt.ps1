param([Parameter(Mandatory = $true)][string]$PayloadBase64)

$json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($PayloadBase64))
$payload = $json | ConvertFrom-Json

Add-Type -AssemblyName System.Drawing
$doc = New-Object System.Drawing.Printing.PrintDocument
$printerName = [string]$payload.printerName
if ($printerName) { $doc.PrinterSettings.PrinterName = $printerName }
if (-not $doc.PrinterSettings.IsValid) { throw "ไม่พบเครื่องพิมพ์ '$printerName' ใน Windows" }

# 58mm = ประมาณ 228 หน่วย (1/100 นิ้ว); ใช้ความสูงมากพอสำหรับใบเสร็จ
$doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('Receipt 58mm', 228, 1400)
$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController

$doc.add_PrintPage({
  param($sender, $event)
  $font = New-Object System.Drawing.Font('Tahoma', 9)
  $fontBold = New-Object System.Drawing.Font('Tahoma', 9, [System.Drawing.FontStyle]::Bold)
  $format = New-Object System.Drawing.StringFormat
  $y = 4
  foreach ($line in $payload.lines) {
    $format.Alignment = if ($line.align -eq 'center') { [System.Drawing.StringAlignment]::Center } else { [System.Drawing.StringAlignment]::Near }
    $useFont = if ($line.bold) { $fontBold } else { $font }
    $event.Graphics.DrawString([string]$line.text, $useFont, [System.Drawing.Brushes]::Black, (New-Object System.Drawing.RectangleF(2, $y, 220, 24)), $format)
    $y += 20
  }
  $font.Dispose(); $fontBold.Dispose(); $format.Dispose()
  $event.HasMorePages = $false
})

$doc.Print()
