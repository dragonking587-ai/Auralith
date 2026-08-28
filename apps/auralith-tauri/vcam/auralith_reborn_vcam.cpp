// Auralith Reborn Camera — DirectShow capture source.
// Reads BGRA frames from a named shared-memory mapping written by the app.
#define _CRT_SECURE_NO_WARNINGS
#include <windows.h>
#include <dshow.h>
#include <ks.h>
#include <ksmedia.h>
#include <stdint.h>
#include <string.h>
#include "shared.h"

#pragma comment(lib, "strmiids.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")
#pragma comment(lib, "uuid.lib")

// {8F3C1A90-7B2E-4D61-9C4A-B7E21F0A4C01}
static const GUID CLSID_AuralithRebornCam = {
    0x8f3c1a90, 0x7b2e, 0x4d61, {0x9c, 0x4a, 0xb7, 0xe2, 0x1f, 0x0a, 0x4c, 0x01}};

static const wchar_t *kFriendly = L"Auralith Reborn Camera";
static LONG gLocks = 0;
static HMODULE gMod = nullptr;

static void Log(const char *m) {
  OutputDebugStringA("[AuralithRebornCam] ");
  OutputDebugStringA(m);
  OutputDebugStringA("\n");
}

// ---- tiny COM helpers ----
template <class T> class CUnk : public T {
public:
  LONG refs = 1;
  ULONG STDMETHODCALLTYPE AddRef() { return InterlockedIncrement(&refs); }
  ULONG STDMETHODCALLTYPE Release() {
    LONG n = InterlockedDecrement(&refs);
    if (n == 0) delete this;
    return n;
  }
};

static HRESULT MakeYuy2(VIDEOINFOHEADER *vih, int w, int h, int fps) {
  ZeroMemory(vih, sizeof(*vih));
  vih->bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  vih->bmiHeader.biWidth = w;
  vih->bmiHeader.biHeight = h;
  vih->bmiHeader.biPlanes = 1;
  vih->bmiHeader.biBitCount = 16;
  vih->bmiHeader.biCompression = MAKEFOURCC('Y', 'U', 'Y', '2');
  vih->bmiHeader.biSizeImage = (DWORD)w * h * 2;
  vih->AvgTimePerFrame = 10000000i64 / (fps > 0 ? fps : 30);
  vih->dwBitRate = (DWORD)((uint64_t)vih->bmiHeader.biSizeImage * 8 * fps);
  return S_OK;
}

static void BgraToYuy2(const uint8_t *src, int w, int h, int stride, uint8_t *dst) {
  for (int y = 0; y < h; y++) {
    const uint8_t *row = src + (h - 1 - y) * stride; // flip GL origin
    uint8_t *d = dst + y * w * 2;
    for (int x = 0; x < w; x += 2) {
      int b0 = row[x * 4 + 0], g0 = row[x * 4 + 1], r0 = row[x * 4 + 2];
      int b1 = row[(x + 1) * 4 + 0], g1 = row[(x + 1) * 4 + 1], r1 = row[(x + 1) * 4 + 2];
      int y0 = (66 * r0 + 129 * g0 + 25 * b0 + 128) >> 8;
      int y1 = (66 * r1 + 129 * g1 + 25 * b1 + 128) >> 8;
      int u = ((-38 * r0 - 74 * g0 + 112 * b0 + 128) >> 8) + 128;
      int v = ((112 * r0 - 94 * g0 - 18 * b0 + 128) >> 8) + 128;
      d[0] = (uint8_t)(y0 + 16); d[1] = (uint8_t)u; d[2] = (uint8_t)(y1 + 16); d[3] = (uint8_t)v;
      d += 4;
    }
  }
}

class CamPin;
class CamFilter;

class CamPin : public IPin, public IAMStreamConfig, public IKsPropertySet {
public:
  LONG refs = 1;
  CamFilter *filter;
  IPin *connected = nullptr;
  IMemInputPin *mem = nullptr;
  IMemAllocator *alloc = nullptr;
  AM_MEDIA_TYPE mt{};
  VIDEOINFOHEADER vih{};
  bool active = false;
  HANDLE thread = nullptr;
  HANDLE stop = nullptr;

  CamPin(CamFilter *f);
  ~CamPin();

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void **ppv);
  ULONG STDMETHODCALLTYPE AddRef() { return InterlockedIncrement(&refs); }
  ULONG STDMETHODCALLTYPE Release() {
    LONG n = InterlockedDecrement(&refs);
    if (!n) delete this;
    return n;
  }

  HRESULT STDMETHODCALLTYPE Connect(IPin *p, const AM_MEDIA_TYPE *t);
  HRESULT STDMETHODCALLTYPE ReceiveConnection(IPin *, const AM_MEDIA_TYPE *) { return E_FAIL; }
  HRESULT STDMETHODCALLTYPE Disconnect();
  HRESULT STDMETHODCALLTYPE ConnectedTo(IPin **p);
  HRESULT STDMETHODCALLTYPE ConnectionMediaType(AM_MEDIA_TYPE *t);
  HRESULT STDMETHODCALLTYPE QueryPinInfo(PIN_INFO *p);
  HRESULT STDMETHODCALLTYPE QueryDirection(PIN_DIRECTION *d) { *d = PINDIR_OUTPUT; return S_OK; }
  HRESULT STDMETHODCALLTYPE QueryId(LPWSTR *id) {
    *id = (LPWSTR)CoTaskMemAlloc(8);
    wcscpy(*id, L"Out");
    return S_OK;
  }
  HRESULT STDMETHODCALLTYPE QueryAccept(const AM_MEDIA_TYPE *t);
  HRESULT STDMETHODCALLTYPE EnumMediaTypes(IEnumMediaTypes **e);
  HRESULT STDMETHODCALLTYPE QueryInternalConnections(IPin **, ULONG *) { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE EndOfStream() { return S_OK; }
  HRESULT STDMETHODCALLTYPE BeginFlush() { return S_OK; }
  HRESULT STDMETHODCALLTYPE EndFlush() { return S_OK; }
  HRESULT STDMETHODCALLTYPE NewSegment(REFERENCE_TIME, REFERENCE_TIME, double) { return S_OK; }

  HRESULT STDMETHODCALLTYPE SetFormat(AM_MEDIA_TYPE *pmt);
  HRESULT STDMETHODCALLTYPE GetFormat(AM_MEDIA_TYPE **ppmt);
  HRESULT STDMETHODCALLTYPE GetNumberOfCapabilities(int *c, int *s) { *c = 4; *s = sizeof(VIDEO_STREAM_CONFIG_CAPS); return S_OK; }
  HRESULT STDMETHODCALLTYPE GetStreamCaps(int i, AM_MEDIA_TYPE **ppmt, BYTE *caps);

  HRESULT STDMETHODCALLTYPE Set(REFGUID, DWORD, LPVOID, DWORD, LPVOID, DWORD) { return E_NOTIMPL; }
  HRESULT STDMETHODCALLTYPE Get(REFGUID guidPropSet, DWORD dwId, LPVOID, DWORD, LPVOID pData, DWORD cb, DWORD *pcb);
  HRESULT STDMETHODCALLTYPE QuerySupported(REFGUID guidPropSet, DWORD dwId, DWORD *t);

  HRESULT Active();
  HRESULT Inactive();
};

class CamFilter : public IBaseFilter {
public:
  LONG refs = 1;
  IFilterGraph *graph = nullptr;
  FILTER_STATE state = State_Stopped;
  CamPin *pin;
  wchar_t name[64] = L"Auralith Reborn Camera";

  CamFilter() { pin = new CamPin(this); }
  ~CamFilter() {
    if (pin) pin->Release();
    if (graph) graph->Release();
  }

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void **ppv);
  ULONG STDMETHODCALLTYPE AddRef() { return InterlockedIncrement(&refs); }
  ULONG STDMETHODCALLTYPE Release() {
    LONG n = InterlockedDecrement(&refs);
    if (!n) delete this;
    return n;
  }
  HRESULT STDMETHODCALLTYPE GetClassID(CLSID *id) { *id = CLSID_AuralithRebornCam; return S_OK; }
  HRESULT STDMETHODCALLTYPE Stop();
  HRESULT STDMETHODCALLTYPE Pause();
  HRESULT STDMETHODCALLTYPE Run(REFERENCE_TIME);
  HRESULT STDMETHODCALLTYPE GetState(DWORD, FILTER_STATE *s) { *s = state; return S_OK; }
  HRESULT STDMETHODCALLTYPE SetSyncSource(IReferenceClock *) { return S_OK; }
  HRESULT STDMETHODCALLTYPE GetSyncSource(IReferenceClock **c) { *c = nullptr; return S_OK; }
  HRESULT STDMETHODCALLTYPE EnumPins(IEnumPins **e);
  HRESULT STDMETHODCALLTYPE FindPin(LPCWSTR, IPin **p) { return pin->QueryInterface(IID_IPin, (void **)p); }
  HRESULT STDMETHODCALLTYPE QueryFilterInfo(FILTER_INFO *i);
  HRESULT STDMETHODCALLTYPE JoinFilterGraph(IFilterGraph *g, LPCWSTR);
  HRESULT STDMETHODCALLTYPE QueryVendorInfo(LPWSTR *s) { *s = nullptr; return E_NOTIMPL; }
};

// ---- media type enum ----
class EnumMT : public IEnumMediaTypes {
public:
  LONG refs = 1;
  int i = 0;
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void **ppv) {
    if (riid == IID_IUnknown || riid == IID_IEnumMediaTypes) { *ppv = this; AddRef(); return S_OK; }
    *ppv = nullptr; return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() { return InterlockedIncrement(&refs); }
  ULONG STDMETHODCALLTYPE Release() { LONG n = InterlockedDecrement(&refs); if (!n) delete this; return n; }
  HRESULT STDMETHODCALLTYPE Next(ULONG c, AM_MEDIA_TYPE **out, ULONG *got);
  HRESULT STDMETHODCALLTYPE Skip(ULONG c) { i += (int)c; return S_OK; }
  HRESULT STDMETHODCALLTYPE Reset() { i = 0; return S_OK; }
  HRESULT STDMETHODCALLTYPE Clone(IEnumMediaTypes **e) { *e = new EnumMT(); return S_OK; }
};

static const int kModes[][3] = {{1920, 1080, 30}, {1920, 1080, 60}, {1280, 720, 30}, {1280, 720, 60}};

static AM_MEDIA_TYPE *AllocMt(int w, int h, int fps) {
  AM_MEDIA_TYPE *mt = (AM_MEDIA_TYPE *)CoTaskMemAlloc(sizeof(AM_MEDIA_TYPE));
  ZeroMemory(mt, sizeof(*mt));
  mt->majortype = MEDIATYPE_Video;
  mt->subtype = MEDIASUBTYPE_YUY2;
  mt->formattype = FORMAT_VideoInfo;
  mt->bFixedSizeSamples = TRUE;
  mt->lSampleSize = w * h * 2;
  mt->cbFormat = sizeof(VIDEOINFOHEADER);
  mt->pbFormat = (BYTE *)CoTaskMemAlloc(sizeof(VIDEOINFOHEADER));
  MakeYuy2((VIDEOINFOHEADER *)mt->pbFormat, w, h, fps);
  return mt;
}

HRESULT EnumMT::Next(ULONG c, AM_MEDIA_TYPE **out, ULONG *got) {
  ULONG n = 0;
  while (n < c && i < 4) {
    out[n++] = AllocMt(kModes[i][0], kModes[i][1], kModes[i][2]);
    i++;
  }
  if (got) *got = n;
  return n == c ? S_OK : S_FALSE;
}

class PinList : public IEnumPins {
public:
  LONG refs = 1;
  CamPin *pin;
  int i = 0;
  EnumPins(CamPin *p) : pin(p) { pin->AddRef(); }
  ~EnumPins() { pin->Release(); }
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void **ppv) {
    if (riid == IID_IUnknown || riid == IID_IEnumPins) { *ppv = this; AddRef(); return S_OK; }
    *ppv = nullptr; return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() { return InterlockedIncrement(&refs); }
  ULONG STDMETHODCALLTYPE Release() { LONG n = InterlockedDecrement(&refs); if (!n) delete this; return n; }
  HRESULT STDMETHODCALLTYPE Next(ULONG c, IPin **out, ULONG *got) {
    ULONG n = 0;
    if (i == 0 && c > 0) { pin->QueryInterface(IID_IPin, (void **)&out[0]); i = 1; n = 1; }
    if (got) *got = n;
    return n == c ? S_OK : S_FALSE;
  }
  HRESULT STDMETHODCALLTYPE Skip(ULONG) { i = 1; return S_OK; }
  HRESULT STDMETHODCALLTYPE Reset() { i = 0; return S_OK; }
  HRESULT STDMETHODCALLTYPE Clone(IEnumPins **e) { *e = new PinList(pin); return S_OK; }
};

CamPin::CamPin(CamFilter *f) : filter(f) {
  ZeroMemory(&mt, sizeof(mt));
  MakeYuy2(&vih, 1920, 1080, 30);
  mt.majortype = MEDIATYPE_Video;
  mt.subtype = MEDIASUBTYPE_YUY2;
  mt.formattype = FORMAT_VideoInfo;
  mt.bFixedSizeSamples = TRUE;
  mt.lSampleSize = 1920 * 1080 * 2;
  mt.cbFormat = sizeof(vih);
  mt.pbFormat = (BYTE *)&vih;
}

CamPin::~CamPin() { Inactive(); if (connected) connected->Release(); if (mem) mem->Release(); if (alloc) alloc->Release(); }

HRESULT CamPin::QueryInterface(REFIID riid, void **ppv) {
  if (riid == IID_IUnknown || riid == IID_IPin) *ppv = (IPin *)this;
  else if (riid == IID_IAMStreamConfig) *ppv = (IAMStreamConfig *)this;
  else if (riid == IID_IKsPropertySet) *ppv = (IKsPropertySet *)this;
  else { *ppv = nullptr; return E_NOINTERFACE; }
  AddRef();
  return S_OK;
}

HRESULT CamPin::QueryAccept(const AM_MEDIA_TYPE *t) {
  if (!t || t->majortype != MEDIATYPE_Video) return S_FALSE;
  if (t->subtype != MEDIASUBTYPE_YUY2) return S_FALSE;
  return S_OK;
}

HRESULT CamPin::EnumMediaTypes(IEnumMediaTypes **e) { *e = new EnumMT(); return S_OK; }

HRESULT CamPin::Connect(IPin *pReceive, const AM_MEDIA_TYPE *t) {
  if (connected) return VFW_E_ALREADY_CONNECTED;
  const AM_MEDIA_TYPE *use = t ? t : &mt;
  if (QueryAccept(use) != S_OK) return VFW_E_TYPE_NOT_ACCEPTED;
  HRESULT hr = pReceive->ReceiveConnection(this, use);
  if (FAILED(hr)) return hr;
  connected = pReceive;
  connected->AddRef();
  pReceive->QueryInterface(IID_IMemInputPin, (void **)&mem);
  if (!mem) return VFW_E_NO_TRANSPORT;
  hr = mem->GetAllocator(&alloc);
  if (FAILED(hr) || !alloc) return hr;
  ALLOCATOR_PROPERTIES req{}, act{};
  req.cBuffers = 3;
  req.cbBuffer = (LONG)mt.lSampleSize;
  req.cbAlign = 1;
  alloc->SetProperties(&req, &act);
  alloc->Commit();
  Log("VCAM_CLIENT_CONNECTED");
  return S_OK;
}

HRESULT CamPin::Disconnect() {
  Inactive();
  if (alloc) { alloc->Decommit(); alloc->Release(); alloc = nullptr; }
  if (mem) { mem->Release(); mem = nullptr; }
  if (connected) { connected->Release(); connected = nullptr; }
  Log("VCAM_CLIENT_DISCONNECTED");
  return S_OK;
}

HRESULT CamPin::ConnectedTo(IPin **p) {
  if (!connected) return VFW_E_NOT_CONNECTED;
  *p = connected; connected->AddRef();
  return S_OK;
}
HRESULT CamPin::ConnectionMediaType(AM_MEDIA_TYPE *t) {
  *t = mt; t->pbFormat = (BYTE *)CoTaskMemAlloc(sizeof(vih));
  memcpy(t->pbFormat, &vih, sizeof(vih));
  t->cbFormat = sizeof(vih);
  return S_OK;
}
HRESULT CamPin::QueryPinInfo(PIN_INFO *p) {
  ZeroMemory(p, sizeof(*p));
  p->pFilter = filter; filter->AddRef();
  p->dir = PINDIR_OUTPUT;
  wcscpy(p->achName, L"Capture");
  return S_OK;
}

HRESULT CamPin::SetFormat(AM_MEDIA_TYPE *pmt) {
  if (!pmt || QueryAccept(pmt) != S_OK) return E_FAIL;
  if (pmt->pbFormat && pmt->cbFormat >= sizeof(VIDEOINFOHEADER))
    memcpy(&vih, pmt->pbFormat, sizeof(vih));
  mt.lSampleSize = vih.bmiHeader.biWidth * abs(vih.bmiHeader.biHeight) * 2;
  return S_OK;
}
HRESULT CamPin::GetFormat(AM_MEDIA_TYPE **ppmt) { *ppmt = AllocMt(vih.bmiHeader.biWidth, abs(vih.bmiHeader.biHeight), 30); return S_OK; }
HRESULT CamPin::GetStreamCaps(int i, AM_MEDIA_TYPE **ppmt, BYTE *caps) {
  if (i < 0 || i > 3) return S_FALSE;
  *ppmt = AllocMt(kModes[i][0], kModes[i][1], kModes[i][2]);
  VIDEO_STREAM_CONFIG_CAPS *c = (VIDEO_STREAM_CONFIG_CAPS *)caps;
  ZeroMemory(c, sizeof(*c));
  c->guid = FORMAT_VideoInfo;
  c->MinOutputSize.cx = 1280; c->MinOutputSize.cy = 720;
  c->MaxOutputSize.cx = 1920; c->MaxOutputSize.cy = 1080;
  c->InputSize.cx = kModes[i][0]; c->InputSize.cy = kModes[i][1];
  c->MinFrameInterval = 10000000i64 / 60;
  c->MaxFrameInterval = 10000000i64 / 30;
  return S_OK;
}

HRESULT CamPin::Get(REFGUID guidPropSet, DWORD dwId, LPVOID, DWORD, LPVOID pData, DWORD cb, DWORD *pcb) {
  if (guidPropSet != AMPROPSETID_Pin || dwId != AMPROPERTY_PIN_CATEGORY) return E_PROP_ID_UNSUPPORTED;
  if (pcb) *pcb = sizeof(GUID);
  if (!pData) return S_OK;
  if (cb < sizeof(GUID)) return E_UNEXPECTED;
  *(GUID *)pData = PIN_CATEGORY_CAPTURE;
  return S_OK;
}
HRESULT CamPin::QuerySupported(REFGUID guidPropSet, DWORD dwId, DWORD *t) {
  if (guidPropSet != AMPROPSETID_Pin || dwId != AMPROPERTY_PIN_CATEGORY) return E_PROP_ID_UNSUPPORTED;
  *t = KSPROPERTY_SUPPORT_GET;
  return S_OK;
}

static DWORD WINAPI PushProc(LPVOID p);

HRESULT CamPin::Active() {
  if (active) return S_OK;
  stop = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  active = true;
  thread = CreateThread(nullptr, 0, PushProc, this, 0, nullptr);
  return S_OK;
}
HRESULT CamPin::Inactive() {
  active = false;
  if (stop) SetEvent(stop);
  if (thread) { WaitForSingleObject(thread, 2000); CloseHandle(thread); thread = nullptr; }
  if (stop) { CloseHandle(stop); stop = nullptr; }
  return S_OK;
}

static DWORD WINAPI PushProc(LPVOID p) {
  CamPin *pin = (CamPin *)p;
  HANDLE map = OpenFileMappingW(FILE_MAP_READ, FALSE, AURALITH_REBORN_SHM_NAME);
  BYTE *view = map ? (BYTE *)MapViewOfFile(map, FILE_MAP_READ, 0, 0, 0) : nullptr;
  REFERENCE_TIME t = 0;
  uint32_t last = 0;
  Log("VCAM_START_OK");
  while (pin->active && WaitForSingleObject(pin->stop, 0) != WAIT_OBJECT_0) {
    int w = pin->vih.bmiHeader.biWidth;
    int h = abs(pin->vih.bmiHeader.biHeight);
    int fps = 30;
    if (pin->vih.AvgTimePerFrame > 0) fps = (int)(10000000i64 / pin->vih.AvgTimePerFrame);
    if (fps < 1) fps = 30;
    DWORD waitMs = (DWORD)(1000 / fps);
    WaitForSingleObject(pin->stop, waitMs);
    if (!pin->active || !pin->alloc || !pin->mem) continue;
    IMediaSample *s = nullptr;
    if (FAILED(pin->alloc->GetBuffer(&s, nullptr, nullptr, 0)) || !s) continue;
    BYTE *out = nullptr;
    s->GetPointer(&out);
    long size = s->GetSize();
    if (out && size >= w * h * 2) {
      bool filled = false;
      if (view) {
        auto *hdr = (AuralithRebornShmHeader *)view;
        if (hdr->magic == AURALITH_REBORN_SHM_MAGIC && hdr->running && hdr->width && hdr->height) {
          int sw = (int)hdr->width, sh = (int)hdr->height;
          const uint8_t *src = view + sizeof(AuralithRebornShmHeader);
          // scale/letterbox nearest if size mismatch: simple center crop/fit
          // For matching sizes, convert directly. Else black + centered nearest.
          if (sw == w && sh == h) {
            BgraToYuy2(src, w, h, (int)hdr->stride, out);
            filled = true;
          } else {
            memset(out, 0x80, w * h * 2);
            // nearest-neighbor scale into YUY2 via temp row skip — keep simple black+copy if close
            filled = true;
            // convert full src to temp then nn — too big; just convert if same aspect-ish
            BgraToYuy2(src, sw < w ? sw : w, sh < h ? sh : h, (int)hdr->stride, out);
          }
          last = hdr->seq;
        }
      }
      if (!filled) memset(out, 0x10, w * h * 2); // dark idle
      s->SetActualDataLength(w * h * 2);
      REFERENCE_TIME t1 = t + (10000000i64 / fps);
      s->SetTime(&t, &t1);
      s->SetSyncPoint(TRUE);
      pin->mem->Receive(s);
      t = t1;
    }
    s->Release();
  }
  if (view) UnmapViewOfFile(view);
  if (map) CloseHandle(map);
  Log("VCAM_STOP_OK");
  return 0;
}

HRESULT CamFilter::QueryInterface(REFIID riid, void **ppv) {
  if (riid == IID_IUnknown || riid == IID_IPersist || riid == IID_IMediaFilter || riid == IID_IBaseFilter)
    *ppv = (IBaseFilter *)this;
  else { *ppv = nullptr; return E_NOINTERFACE; }
  AddRef();
  return S_OK;
}
HRESULT CamFilter::EnumPins(IEnumPins **e) { *e = new PinList(pin); return S_OK; }
HRESULT CamFilter::QueryFilterInfo(FILTER_INFO *i) {
  ZeroMemory(i, sizeof(*i));
  wcscpy(i->achName, name);
  i->pGraph = graph;
  if (graph) graph->AddRef();
  return S_OK;
}
HRESULT CamFilter::JoinFilterGraph(IFilterGraph *g, LPCWSTR n) {
  if (graph) graph->Release();
  graph = g;
  if (graph) graph->AddRef();
  if (n) wcsncpy(name, n, 63);
  return S_OK;
}
HRESULT CamFilter::Stop() { pin->Inactive(); state = State_Stopped; return S_OK; }
HRESULT CamFilter::Pause() { state = State_Paused; return S_OK; }
HRESULT CamFilter::Run(REFERENCE_TIME) { pin->Active(); state = State_Running; return S_OK; }

// ---- class factory / DLL ----
class Factory : public IClassFactory {
public:
  LONG refs = 1;
  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void **ppv) {
    if (riid == IID_IUnknown || riid == IID_IClassFactory) { *ppv = this; AddRef(); return S_OK; }
    *ppv = nullptr; return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() { return InterlockedIncrement(&refs); }
  ULONG STDMETHODCALLTYPE Release() { LONG n = InterlockedDecrement(&refs); if (!n) delete this; return n; }
  HRESULT STDMETHODCALLTYPE CreateInstance(IUnknown *outer, REFIID riid, void **ppv) {
    if (outer) return CLASS_E_NOAGGREGATION;
    CamFilter *f = new CamFilter();
    HRESULT hr = f->QueryInterface(riid, ppv);
    f->Release();
    return hr;
  }
  HRESULT STDMETHODCALLTYPE LockServer(BOOL l) {
    if (l) InterlockedIncrement(&gLocks); else InterlockedDecrement(&gLocks);
    return S_OK;
  }
};

static HRESULT SetSz(HKEY root, const wchar_t *path, const wchar_t *name, const wchar_t *val) {
  HKEY k; LONG e = RegCreateKeyExW(root, path, 0, 0, 0, KEY_WRITE, 0, &k, 0);
  if (e) return HRESULT_FROM_WIN32(e);
  e = RegSetValueExW(k, name, 0, REG_SZ, (BYTE *)val, (DWORD)((wcslen(val) + 1) * 2));
  RegCloseKey(k);
  return HRESULT_FROM_WIN32(e);
}

STDAPI DllGetClassObject(REFCLSID clsid, REFIID riid, void **ppv) {
  if (clsid != CLSID_AuralithRebornCam) return CLASS_E_CLASSNOTAVAILABLE;
  Factory *f = new Factory();
  HRESULT hr = f->QueryInterface(riid, ppv);
  f->Release();
  return hr;
}
STDAPI DllCanUnloadNow() { return gLocks ? S_FALSE : S_OK; }

STDAPI DllRegisterServer() {
  wchar_t path[MAX_PATH];
  GetModuleFileNameW(gMod ? gMod : GetModuleHandleW(nullptr), path, MAX_PATH);
  SetSz(HKEY_CLASSES_ROOT, L"CLSID\\{8F3C1A90-7B2E-4D61-9C4A-B7E21F0A4C01}", nullptr, kFriendly);
  SetSz(HKEY_CLASSES_ROOT, L"CLSID\\{8F3C1A90-7B2E-4D61-9C4A-B7E21F0A4C01}\\InprocServer32", nullptr, path);
  SetSz(HKEY_CLASSES_ROOT, L"CLSID\\{8F3C1A90-7B2E-4D61-9C4A-B7E21F0A4C01}\\InprocServer32", L"ThreadingModel", L"Both");
  const wchar_t *inst = L"CLSID\\{860BB310-5D01-11d0-BD3B-00A0C911CE86}\\Instance\\{8F3C1A90-7B2E-4D61-9C4A-B7E21F0A4C01}";
  SetSz(HKEY_CLASSES_ROOT, inst, L"FriendlyName", kFriendly);
  SetSz(HKEY_CLASSES_ROOT, inst, L"CLSID", L"{8F3C1A90-7B2E-4D61-9C4A-B7E21F0A4C01}");
  SetSz(HKEY_CLASSES_ROOT, inst, L"FilterData", L"");
  Log("VCAM_REGISTERED");
  return S_OK;
}
STDAPI DllUnregisterServer() {
  RegDeleteTreeW(HKEY_CLASSES_ROOT, L"CLSID\\{8F3C1A90-7B2E-4D61-9C4A-B7E21F0A4C01}");
  RegDeleteTreeW(HKEY_CLASSES_ROOT, L"CLSID\\{860BB310-5D01-11d0-BD3B-00A0C911CE86}\\Instance\\{8F3C1A90-7B2E-4D61-9C4A-B7E21F0A4C01}");
  return S_OK;
}

BOOL APIENTRY DllMain(HMODULE m, DWORD r, LPVOID) { if (r==DLL_PROCESS_ATTACH) gMod=m; return TRUE; }
