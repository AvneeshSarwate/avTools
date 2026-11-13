## 2026-04-29T15:37:47.629Z - v3-row-transient-snow-wide-grid
args: `--width=160 --height=120 --frame=0 --profile=stable --out=.output/ntsc-vhs-gpu-smoke --write-top=3`
profile: stable, frame: 0, size: 160x120
grid: off, candidates: 6
best: v3-stable-base, rmse=25.3550, mae=14.7646, max=228, diff=14723/19200

| rank | candidate | rmse | mae | max | diff pixels | settings |
| ---: | --- | ---: | ---: | ---: | ---: | --- |
| 1 | v3-stable-base | 25.3550 | 14.7646 | 228 | 14723/19200 | `{"lumaSmear":0,"chromaBlur":0.3,"chromaDelayX":0,"chromaDelayY":0,"compositeSharpness":1.55,"ringingIntensity":0,"ringingFrequency":0.42,"vhsSharpen":0.16,"scanlineIntensity":0,"edgeWaveIntensity":0,"edgeWaveFrequency":0.045,"edgeWaveSpeed":0.9,"headSwitchingHeight":0,"headSwitchingShift":0,"noiseIntensity":0,"snowDensity":0,"snowStrength":0.65,"chromaPhaseError":0,"chromaLossDensity":0,"chromaLossAmount":1,"verticalBlend":1,"tapeSpeed":1}` |
| 2 | v2-sharper | 42.2283 | 26.2706 | 228 | 15698/19200 | `{"lumaSmear":0.18,"chromaBlur":0.55,"chromaDelayX":0,"chromaDelayY":0,"compositeSharpness":0.88,"ringingIntensity":1.25,"ringingFrequency":0.42,"vhsSharpen":0.24,"scanlineIntensity":0,"edgeWaveIntensity":0,"edgeWaveFrequency":0.045,"edgeWaveSpeed":0.9,"headSwitchingHeight":0,"headSwitchingShift":0,"noiseIntensity":0,"snowDensity":0,"snowStrength":0.65,"chromaPhaseError":0,"chromaLossDensity":0,"chromaLossAmount":1,"verticalBlend":1,"tapeSpeed":1}` |
| 3 | v1-default | 44.8405 | 28.4728 | 226 | 15693/19200 | `{"lumaSmear":0.25,"chromaBlur":0.72,"chromaDelayX":2,"chromaDelayY":0,"compositeSharpness":0.65,"ringingIntensity":1,"ringingFrequency":0.42,"vhsSharpen":0.16,"scanlineIntensity":0,"edgeWaveIntensity":0,"edgeWaveFrequency":0.045,"edgeWaveSpeed":0.9,"headSwitchingHeight":0,"headSwitchingShift":0,"noiseIntensity":0,"snowDensity":0,"snowStrength":0.65,"chromaPhaseError":0,"chromaLossDensity":0,"chromaLossAmount":1,"verticalBlend":1,"tapeSpeed":1}` |

