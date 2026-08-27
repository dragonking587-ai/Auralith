# Audio analysis

WASAPI loopback (desktop/system output) via NAudio.

Initial band edges (48 kHz, 2048 FFT, bin ≈ 23.4 Hz):

| Band | Hz (approx) |
|------|-------------|
| Bass | 20–80 |
| Low | 80–250 |
| Mid | 250–4000 |
| High | 4000–16000 |
| Full Mix | RMS |
| Beat | low-band spectral flux |
| Transient | flux spike |

Capture and FFT run off the UI thread.
