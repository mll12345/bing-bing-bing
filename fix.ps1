$p='src/main.js'
$s=[IO.File]::ReadAllText($p)
$s=$s.Replace("  drum: `$('drum'),`r`n","")
$s=$s.Replace("  vDrum: `$('vDrum'),`r`n","")
$s=$s.Replace("  const dr = Number(el.drum.value);`r`n  el.vDrum.textContent = dr <= 0.02 ? '关' : dr.toFixed(2);`r`n","")
$s=$s.Replace("[el.voice, el.timbre, el.keep, el.rev, el.sparkle, el.drum, el.maxLen]","[el.voice, el.timbre, el.keep, el.rev, el.sparkle, el.maxLen]")
$s=$s.Replace("      drum: Number(el.drum.value),`r`n","")
$s=$s.Replace("      ['鼓组', info.drum <= 0.02 ? '关' : info.drum.toFixed(2)],`r`n","")
[IO.File]::WriteAllText($p,$s)
Write-Host 'drum refs left:'
Select-String -Path $p -Pattern 'drum' | ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" }
