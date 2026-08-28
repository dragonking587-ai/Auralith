#pragma once
#include <stdint.h>
#define AURALITH_REBORN_SHM_NAME L"Local\\AuralithRebornCam_SHM"
#define AURALITH_REBORN_SHM_MAX_W 1920
#define AURALITH_REBORN_SHM_MAX_H 1920
#define AURALITH_REBORN_SHM_MAX_PIXELS (AURALITH_REBORN_SHM_MAX_W * AURALITH_REBORN_SHM_MAX_H * 4)
#define AURALITH_REBORN_SHM_MAGIC 0x4152434D /* ARCM */
#define AURALITH_FMT_BGRA 1
typedef struct AuralithRebornShmHeader {
  uint32_t magic;
  uint32_t width;
  uint32_t height;
  uint32_t stride;
  uint32_t format;
  uint32_t seq;
  uint32_t running;
  uint32_t reserved;
  uint64_t timestamp_qpc;
} AuralithRebornShmHeader;
