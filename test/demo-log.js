// sinh một log GIẢ đủ lớn để chụp ảnh màn hình cho README
//
// Vì sao không chụp trên log thật: .gitignore cấm commit *.yml VÀ cấm cả *.png, cùng một lý do —
// log feedback thật chứa số điện thoại, token, mã giao dịch của người dùng thật, và ảnh chụp màn hình
// thì lộ nguyên văn những thứ đó. Mọi dòng dưới đây đều bịa; tên app, tên màn, mã lỗi không lấy từ đâu.
//
// Khác test/fixture.js ở chỗ: fixture cố ý tối thiểu và từng dòng đều ứng với một phép thử. File này
// ngược lại — cần DÀY và ĐA DẠNG để mọi tab trong ảnh chụp đều có gì để xem.
//
//   node test/demo-log.js /duong/dan/demo.html
// rồi mở trang đó (qua http, không phải file://) — extension/lens.js tự bung panel lên.

const fs = require('fs');
const path = require('path');

let clock = Date.UTC(2026, 8, 9, 2, 12, 0); // 09:12:00 GMT+7
const lines = [];

function stamp(ms) {
  const d = new Date(ms + 7 * 3600000);
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' +
    p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + ':' +
    p(d.getUTCMilliseconds(), 3) + ' GMT+07:00';
}

function line(level, body, advanceMs) {
  clock += advanceMs == null ? 40 : advanceMs;
  lines.push(stamp(clock) + ' ' + level.padEnd(7) + ' ' + body);
}

function tracker(event, params, advanceMs) {
  line('INFO', '[Module: MoMoTracker] event: ' + event + ' | params: {' + params + '}', advanceMs);
}

function grafana(verb, params, advanceMs) {
  line('INFO', '[Module: Grafana] @@ grafana >> ' + verb +
    ' >> generateParams >> parameter: TraceParameter(' + params + ')', advanceMs);
}

const SCREENS = ['ManHinhChinh', 'ManHinhChuyenTien', 'ManHinhViDemo', 'ManHinhHoaDon',
  'ManHinhQuaTang', 'ManHinhTaiKhoan', 'ManHinhLichSu'];
const BUTTONS = ['nut_chuyen_tien', 'nut_nap_the', 'nut_quet_ma', 'nut_hoa_don', 'nut_qua_tang',
  'nut_lich_su', 'nut_dong_y'];
const APIS = ['API_DANH_SACH_VI', 'API_CHUYEN_TIEN', 'API_HOA_DON', 'API_QUA_TANG', 'API_LICH_SU'];
const MODULES = ['ViDemo', 'ChuyenTienDemo', 'HoaDonDemo', 'QuaTangDemo', 'DongBoDemo', 'MangDemo'];

let traceSeq = 1000;
function nextId(prefix) {
  traceSeq += 7;
  return prefix + '-' + traceSeq.toString(36).toUpperCase();
}

function boot(sessionIndex) {
  // Ba mốc khởi động nổ sát nhau y như log thật — để ảnh chụp chứng minh luôn rằng một lần mở app
  // vẫn chỉ đếm thành MỘT phiên.
  line('INFO', '[Module: CoSoDuLieuDemo] MomoDatabase init OK in ' + (11 + sessionIndex) + 'ms', 900);
  line('INFO', '@@ appSync >> syncStartApp', 369);
  line('INFO', '[Module: CoSoDuLieuDemo] [PERF] SyncAppFeature, start', 382);
  line('INFO', '@@SdkProvider ::1. All 3 SDK providers registered');
  line('INFO', '@@DynamicConfig :: DynamicConfigManager initialized');
  line('INFO', '@@DynamicConfig :: Fetching config for appId: vn.demo.nentang');
  line('INFO', '@@DynamicConfig :: responseBody: {"response_info":{"error_message":"Successfully retrieved ' +
    'configurations","error_code":200},"items":{"main_setting":{"keyName":"main_setting","masterConfigData":' +
    '{"owner":"DemoTeam"},"value":{"so_lan_thu_lai":3,"cho_toi_da_ms":8000,"bat_che_do_moi":true}}}}');
  line('INFO', '@@DynamicConfig :: Transformed config for vn.demo.nentang with 8 namespaced keys');
  line('INFO', '[Module: BaoLoiDemo] Persist SentryRemoteConfig key=sentry_remote_config raw=' +
    '{"enable":true,"handledRate":0.3,"unhandledRate":0.3,"anrRate":1.0,"enableANR":false,"ignoreList":[],' +
    '"tracesSampleRate":0.001,"enableAutoSessionTracking":true,"sessionTrackingIntervalMillis":30000}');
  line('INFO', '@@SentryKMP :: options tracesSampleRate=0.001 hasPersistedRemoteConfig=true');
  line('INFO', '@@SentryKMP :: iOS init done enabled=true tracesSampleRate=0.001 profilesSampleRate=0.0 ' +
    'performanceV2=true autoPerformance=true fileIOTracing=false userInteraction=false appHang=true');
  line('INFO', '@@ abTesting >> getABTestFlow :: getAndSaveRemoteAllConfigs...');
  [['MAN_CHINH_BO_CUC_MOI', 'bo_cuc_moi', 'bo_cuc.2', 'nhanh_moi'],
    ['O_TIM_GOI_Y', 'goi_y_tim_kiem', 'goi_y_tim_kiem.1', 'co_goi_y'],
    ['XAC_THUC_SINH_TRAC', '', '', 'DEFAULT_GROUP'],
    ['THANH_TOAN_MOT_CHAM', 'mot_cham', 'mot_cham.3', 'doi_chung']]
    .forEach(([ns, def, name, tag]) => {
      line('INFO', '@@ abTesting >> getABTestFlow :: namespace: ' + ns + ' - config: ABTestingExpTag(namespace=' +
        ns + ', exp_definition=' + def + ', exp_name=' + name + ', tag=' + tag +
        ', last_updated=1780000000000000) - defaultFlow: mac_dinh - cacheOnly: false');
      line('INFO', '@@ abTesting >> logTagConfig :: config: ABTestingExpTag(namespace=' + ns +
        ', exp_definition=' + def + ', exp_name=' + name + ', tag=' + tag + ', last_updated=1780000000000000)');
    });
  ['bang_loi_ngan_hang.json', 'he_thong_thiet_ke.json', 'phi_giao_dich.json', 'nhom_giao_dich.json',
    'anh_dem_san.json'].forEach((name) => {
    line('INFO', '[Module: KhoCauHinhDemo] @@ configs >> fetchConfig >> url: https://tinh-tai.demo/json/' + name);
  });
  ['tabbar_trangchu', 'tabbar_lichsu', 'tabbar_taikhoan'].forEach((key) => {
    line('INFO', '[Module: SYNC, FEATURE] reddotFlow getLocalized > webadmin config ' + key + ' ');
  });
  line('INFO', '[Module: CapNhatTinhNang] [AppFeatureUpdater.getFeatureConfigurations()] Config -> min:120, ' +
    'mustHave:[tabbar_trangchu,tabbar_lichsu,tabbar_taikhoan,chuyen_tien,quet_ma,hoa_don], useDefault:[true,false]');
  line('INFO', '[Module: DEFAULT] ApiSpamDetector: isEnabled: true - ApiSpamDetector: Config: enablePopup: true - ' +
    'blacklistAppIds: [vn.demo.nentang] - blackListApis: [] - Window: 5000ms - maxPoints: 100- apiWeights: 34 entries');
}

// Map header của request. Bịa hoàn toàn, nhưng tái tạo đúng những đặc tính đã gặp trên log thật:
// không parse được bằng JSON.parse (giá trị bị làm mờ để lại chuỗi trần không khoá), User-Agent kiểu
// Android, và IP đổi giữa chừng — để mục "Máy & môi trường" trong ảnh chụp có đủ thứ để xem.
function demoHeader(appId, version, ip, timezone) {
  return '--header: {"deviceid":"6a1f0d9c44b7e25839ac71d0f6b3e88c4d9021fa77bc3e5610a4d8f2b93c07e5",' +
    '"device-name":"Oppo CPH2083","device-ip":"' + ip + '","authorization":"---MoMo---",' +
    '"map_appId":"' + appId + '","map_miniAppVersion":"' + version + '","device_os":"ANDROID",' +
    '"device_performance":"low-end","app_version":"51500","app_code":"5.15.0","channel":"APP",' +
    '"lang":"vi","User-Agent":"momotransfer/5.15.0.51500 Dalvik/2.1.0 (Linux; U; Android 9; ' +
    'CPH2083 Build/PPR1.180610.011)","agent_id":"70000001","****","****",' +
    '"sessionKey":"---MoMo---","M-Timezone":"' + timezone + '","env":"production"}';
}

function apiCall(api, screen, ok, ms) {
  const traceId = nextId('TRACE');
  const cmdId = nextId('CMD');
  const url = 'https://api.demo/' + api.toLowerCase().replace(/_/g, '/');
  // Đổi miniapp và đổi IP giữa chừng để mục Máy & môi trường có danh sách chứ không chỉ một giá trị.
  const appId = traceSeq % 3 === 0 ? 'vn.demo.quy_dau_tu' : 'vn.demo.nentang';
  const version = traceSeq % 3 === 0 ? '694' : (traceSeq % 7 === 0 ? '1902' : '1901');
  const ip = traceSeq % 11 === 0 ? '10.20.30.40' : '42.118.185.199';
  // Múi giờ đổi MỘT LẦN giữa chừng (không xen kẽ như IP): đó là hình dạng thật của việc người dùng
  // bay sang múi giờ khác hoặc máy đồng bộ lại giờ.
  // traceSeq bắt đầu từ 1000 và cộng 7 mỗi lần, nên mốc phải là 1500 chứ không phải một số nhỏ —
  // để 12 thì mọi dòng đều rơi vào vế sau và log demo không còn chỗ nào đổi múi giờ.
  const timezone = traceSeq > 1500 ? 'Asia/Bangkok' : 'Asia/Ho_Chi_Minh';
  tracker('ops_request_be', 'api=' + api + ', api_path=' + api.toLowerCase() + ', trace_id=' + traceId +
    ', screen_name=' + screen + ', miniapp_track_timestamp=' + (clock + 3));
  line('INFO', '[Module: HTTP] [Method: POST] [URL: ' + url + '] [RequestPayload: --encrypted: false --body: ' +
    '{"cmdId":"' + cmdId + '","user":"nguoi-dung-demo","so_tien":' + (10000 + (traceSeq % 90) * 1000) + '} ' +
    demoHeader(appId, version, ip, timezone) + ']');
  grafana('startTrace', 'flow=http_request_v2, step=' + api.toLowerCase() + '_start, appId=vn.demo.nentang, ' +
    'errorCode=null, errorMessage=null', ms);
  if (ok) {
    // Thỉnh thoảng trả về JSON in nhiều dòng: trang admin render mỗi dòng vật lý thành một logRow
    // riêng, tức khối JSON bị tách ra và dòng mở khối không bao giờ đóng trong chính nó. Gặp thật
    // trên log production, nên ảnh chụp và bản thử tay phải có ít nhất một khối như vậy.
    if (traceSeq % 13 === 0) {
      line('INFO', '[Module: HTTP] [Method: POST] [URL: ' + url + '] [ResponsePayload: --encrypted: false ' +
        '--status: 200 --body: {');
      lines.push('"cmdId": "' + cmdId + '",');
      lines.push('"errorCode": 0,');
      lines.push('"lstCountry": [');
      lines.push('{');
      lines.push('"countryName": "Việt Nam",');
      lines.push('"flagUrl": "https://static.demo/img_flag_vn.png",');
      lines.push('"timezone": [');
      lines.push('"Asia/Ho_Chi_Minh",');
      lines.push('"Asia/SaiGon"');
      lines.push('],');
      lines.push('"regionCode": "VN"');
      lines.push('}');
      lines.push('],');
      lines.push('"message": "Thành công"');
      lines.push('}]');
    } else {
      line('INFO', '[Module: HTTP] [Method: POST] [URL: ' + url + '] [ResponsePayload: --encrypted: false ' +
        '--status: 200 --body: {"cmdId":"' + cmdId + '","errorCode":0,"result":true,"message":"Thành công"}]');
    }
    tracker('ops_receive_be', 'api=' + api + ', trace_id=' + traceId + ', status=success, error_code=0, duration=' +
      ms + '.0, screen_name=' + screen);
    grafana('traceSuccess', 'flow=http_request_v2, step=' + api.toLowerCase() + '_success, appId=vn.demo.nentang, ' +
      'errorCode=null, errorMessage=null');
    return;
  }
  line('INFO', '[Module: HTTP] [Method: POST] [URL: ' + url + '] [ResponsePayload: --encrypted: false ' +
    '--status: 500 --body: {"cmdId":"' + cmdId + '","errorCode":-2001,"message":"Hệ thống bận, thử lại sau"}]');
  tracker('ops_receive_be', 'api=' + api + ', trace_id=' + traceId + ', status=fail, error_code=-2001, duration=' +
    ms + '.0, screen_name=' + screen);
  grafana('traceFail', 'flow=http_request_v2, step=' + api.toLowerCase() + '_fail, appId=vn.demo.nentang, ' +
    'errorCode=500.0, errorMessage=500 - Hệ thống bận, thử lại sau');
  line('ERROR', '[Module: ' + MODULES[traceSeq % MODULES.length] + '] gọi ' + api + ' thất bại sau ' + ms +
    'ms, mã -2001');
}

function browse(count) {
  for (let i = 0; i < count; i += 1) {
    const screen = SCREENS[(traceSeq + i) % SCREENS.length];
    const prev = SCREENS[(traceSeq + i + 6) % SCREENS.length];
    tracker('auto_screen_navigated', 'app_id=vn.demo.nentang, screen_name=' + screen +
      ', pre_screen_name=' + prev + ', action=push', 120);
    tracker('auto_screen_displayed', 'screen_name=' + screen + ', state=load, duration=' +
      (280 + ((traceSeq * 37 + i * 91) % 3400)) + ', component_name=Screen');
    tracker('component_impressed', 'screen_name=' + screen + ', component_id=the_' + (i % 5) +
      ', component_name=The gioi thieu ' + (i % 5));
    tracker('service_button_clicked', 'service_name=dich_vu_demo, screen_name=' + screen +
      ', button_name=' + BUTTONS[(traceSeq + i) % BUTTONS.length] + ', duration=' + (200 + (i % 9) * 55));
    if (i % 3 === 0) {
      apiCall(APIS[(traceSeq + i) % APIS.length], screen, i % 9 !== 0, 90 + ((traceSeq + i * 13) % 900));
    }
    if (i % 7 === 3) {
      line('WARNING', '[Module: ' + MODULES[(i + 2) % MODULES.length] + '] danh sách trả về rỗng, dùng bản đệm');
    }
    if (i % 11 === 5) {
      tracker('auto_popup_displayed', 'app_id=vn.demo.nentang, screen_name=' + screen +
        ', action=open, title=Không kết nối được, thử lại nhé');
    }
    if (i % 13 === 9) {
      line('ERROR', '[Module: Grafana] @@ grafana >> DefaultRequestQueue >> handleError >> error: kotlin.Exception');
    }
    if (i % 17 === 4) {
      line('ERROR', '[Module: ' + MODULES[(i + 1) % MODULES.length] + '] không tải được mục ' +
        (40 + i) + ' từ kho dữ liệu');
    }
    if (i % 23 === 12) {
      tracker('feature_miniapp_load', 'app_id=vn.demo.quatang, miniapp_type=miniapp_rn, feature_code=qua_tang, ' +
        'stage=scr_fail_loading_miniapp');
    }
    if (i % 29 === 17) line('INFO', '[Module: NhanRoiDemo] không có gì xảy ra', 4200);
  }
}

function build() {
  lines.length = 0;
  clock = Date.UTC(2026, 8, 9, 2, 12, 0);
  boot(1);
  browse(96);
  line('INFO', '[Module: NhanRoiDemo] app vào nền, chờ người dùng quay lại', 7600);
  boot(2);
  browse(74);
  // Cấu hình đổi giữa chừng phiên — đúng thứ mà tab Cấu hình đánh dấu "2 giá trị khác nhau".
  line('INFO', '[Module: BaoLoiDemo] Persist SentryRemoteConfig key=sentry_remote_config raw=' +
    '{"enable":true,"handledRate":1.0,"unhandledRate":1.0,"anrRate":1.0,"enableANR":true,"ignoreList":[],' +
    '"tracesSampleRate":0.05,"enableAutoSessionTracking":true,"sessionTrackingIntervalMillis":15000}');
  browse(38);
  return lines.slice();
}

function writePage(target) {
  const esc = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = build().map((text) => '<div class="logRow_demo">' + esc(text) + '</div>').join('\n');
  const html = '<!doctype html><meta charset="utf-8"><title>Log demo (dữ liệu bịa)</title>' +
    '<style>body{margin:0;background:#0f0f12;color:#d9d9e3;font:12px ui-monospace,Menlo,monospace}' +
    '#log{height:100vh;overflow:auto;padding:10px}' +
    '.logRow_demo{padding:2px 6px;border-bottom:1px solid #1c1c22;white-space:pre-wrap;word-break:break-all}' +
    '</style><div id="log">' + rows + '</div><script src="lens.js"><\/script>';
  fs.writeFileSync(target, html);
  return { file: target, lines: lines.length };
}

module.exports = { build, writePage };

if (require.main === module) {
  const target = process.argv[2] || path.join(__dirname, '..', 'demo.html');
  const result = writePage(target);
  process.stdout.write(result.file + ' — ' + result.lines + ' dòng log bịa\n');
}
