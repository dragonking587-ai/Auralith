# SAM 2 / SAM 2.1 attribution

Auralith Reborn Phase 1.2 Enhanced Vision is designed to optionally use
Meta Segment Anything Model 2 / SAM 2.1 checkpoints.

Official source: https://github.com/facebookresearch/sam2
License: Apache License 2.0

Auralith does not bundle SAM weights in the base installer.
Any Enhanced model file must be downloaded only after explicit user consent
and verified before use.

## ONNX export used by Auralith Reborn 1.0.0-rc.7

Auralith downloads (only after explicit user consent):

- https://huggingface.co/SharpAI/sam2-hiera-tiny-onnx/resolve/main/encoder.onnx
  SHA-256: df265cb552475e1b3a6cb57c939e57c95ed849bfc2f985c06efab85d8bca6db9
  Size: 134261315 bytes
- https://huggingface.co/SharpAI/sam2-hiera-tiny-onnx/resolve/main/decoder.onnx
  SHA-256: 63198f1f1e273d8f2f4a9d1baf926e53a01d78dc50e0674640e1513dc00d9927
  Size: 20639854 bytes

These files are ONNX conversions of Meta SAM 2 Hiera Tiny
(facebook/sam2-hiera-tiny), Apache-2.0.

Runtime: onnxruntime-web 1.21 WASM (loaded from jsDelivr at session start).
No image is uploaded. Inference is local after the model files are cached.
