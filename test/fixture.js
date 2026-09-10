// sinh log GIẢ để test. Không một dòng nào lấy từ log thật:
// .gitignore cấm commit *.yml/*.log vì chúng chứa dữ liệu người dùng. Fixture này chỉ tái tạo
// những ĐẶC TÍNH đã gặp trên log thật (ghi lặp, trace_id trùng, timestamp lùi, popup ở mức INFO),
// còn nội dung thì bịa sạch.

let clock = Date.UTC(2026, 0, 2, 3, 0, 0); // 10:00:00 GMT+7

function stamp(ms) {
  const d = new Date(ms + 7 * 3600000);
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' +
    p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + ':' +
    p(d.getUTCMilliseconds(), 3) + ' GMT+07:00';
}

const lines = [];

// advance = 0 cho phép đặt hai dòng cùng mốc thời gian (log thật có cả dòng timestamp lùi).
function line(level, body, advanceMs) {
  clock += advanceMs == null ? 10 : advanceMs;
  lines.push(stamp(clock) + ' ' + level.padEnd(7) + ' ' + body);
}

function tracker(event, params, advanceMs) {
  line('INFO', '[Module: MoMoTracker] event: ' + event + ' | params: {' + params + '}', advanceMs);
}

function grafana(verb, params, advanceMs) {
  line('INFO', '[Module: Grafana] @@ grafana >> ' + verb +
    ' >> generateParams >> parameter: TraceParameter(' + params + ')', advanceMs);
}

function build() {
  lines.length = 0;
  clock = Date.UTC(2026, 0, 2, 3, 0, 0);

  line('INFO', '[Module: GiaLapDb] MomoDatabase init OK');

  // --- màn hình + chạm thường
  tracker('auto_screen_navigated', 'app_id=vn.gia.lap, screen_name=ManHinhMot, pre_screen_name=ManHinhGoc, action=push');
  tracker('service_button_clicked', 'service_name=dich_vu_bia, screen_name=man_mot, button_name=nut_bia');

  // --- GHI LẶP: cùng một thao tác, hai dòng cách 2ms -> phải gộp thành 1 bước count=2
  tracker('service_button_clicked', 'service_name=dich_vu_bia, screen_name=man_hai, button_name=nut_lap, user_type=A', 500);
  tracker('service_button_clicked', 'service_name=dich_vu_bia, screen_name=man_hai, button_name=nut_lap, user_type=B', 2);

  // --- CÁCH XA: cùng nhãn nhưng cách 5s -> KHÔNG được gộp
  tracker('service_button_clicked', 'service_name=dich_vu_bia, screen_name=man_hai, button_name=nut_lap, user_type=A', 5000);

  // --- popup ở mức INFO: thứ mà phần gom nhóm lỗi không bao giờ thấy
  tracker('auto_popup_displayed', 'app_id=vn.gia.lap, screen_name=ManHinhMot, action=open, title=Popup Bia Canh Bao');
  // --- HAI popup KHÁC NHAU nhưng đều title=null. Chỉ lấy title thì cả hai cùng tên "popup" và bị gom
  // thành một hàng "2x popup" — mất sạch cái để phân biệt. Phải tụt xuống component_name.
  tracker('auto_popup_displayed', 'app_id=vn.gia.lap, screen_name=ManHinhMot, feature_code=tinh_nang_bia, ' +
    'component_name=goi_y_yeu_thich, action=open, title=null, desc=null');
  tracker('auto_popup_displayed', 'app_id=vn.gia.lap, screen_name=ManHinhHai, feature_code=tinh_nang_khac, ' +
    'component_id=vn.gia.lap/tinh_nang_khac/ManHinhHai/Popup/nhac_cap_nhat, action=open, title=null');

  // --- ops: MỘT call nhưng log ghi thành HAI dòng cùng trace_id -> dedupe còn 1
  tracker('ops_request_be', 'api=API_BIA_MOT, api_path=bia/mot, trace_id=TRACE-BIA-0001, screen_name=ManHinhMot');
  tracker('ops_receive_be', 'api=API_BIA_MOT, api_path=bia/mot, trace_id=TRACE-BIA-0001, status=fail, error_code=500, duration=120.0, screen_name=ManHinhMot');
  tracker('ops_receive_be', 'api=API_BIA_MOT, api_path=bia/mot, trace_id=TRACE-BIA-0001, status=fail, error_code=500, duration=121.0, screen_name=ManHinhMot', 1);

  // --- hai call fail RIÊNG BIỆT, khác trace_id, cách nhau 300ms:
  // bước fail KHÔNG được gộp dù sát nhau, vì mỗi trace_id là một call thật
  tracker('ops_request_be', 'api=API_BIA_HAI, api_path=bia/hai, trace_id=TRACE-BIA-0002, screen_name=ManHinhMot');
  tracker('ops_receive_be', 'api=API_BIA_HAI, api_path=bia/hai, trace_id=TRACE-BIA-0002, status=fail, error_code=404, duration=90.0, screen_name=ManHinhMot');
  tracker('ops_receive_be', 'api=API_BIA_HAI, api_path=bia/hai, trace_id=TRACE-BIA-0003, status=fail, error_code=404, duration=91.0, screen_name=ManHinhMot', 300);

  // --- một call thành công, để apiTotal != apiFail
  tracker('ops_receive_be', 'api=API_BIA_BA, api_path=bia/ba, trace_id=TRACE-BIA-0004, status=success, error_code=0, duration=45.0');

  // --- giá trị có dấu phẩy bên trong và map lồng nhau: phép thử cho parseKeyValueMap
  tracker('auto_screen_displayed', 'screen_name=ManHinhHai, duration=1500, bundle_sof=1,2, last_component={ten=NutBia, nhan=[a, b]}');

  // --- HTTP kiểu dòng [Method:] — nguồn khác hẳn với ops_*
  // Header mang vân tay môi trường: máy gì, iOS mấy, bản nào. Trên log thật đây là nguồn DUY NHẤT
  // còn sống ở log production (module DeviceProfileManager bằng 0 ở đó).
  line('INFO', '[Module: HTTP] [Method: POST] [URL: https://gia.lap/bia/mot] --RequestPayload: ' +
    '--header: {"User-Agent":"MoMoPlatform GIALAP/9.9.9.99900 CFNetwork/1410.1 Darwin/22.6.0 ' +
    '(iPhone Bia Plus iOS/18.7.16) AgentID/BIA", device_os=IOS, device_performance=low-end, lang=vi} ' +
    '--body: {"cmdId":"CMD-BIA-1"}');
  line('INFO', '[Module: HTTP] [Method: POST] [URL: https://gia.lap/bia/mot] --ResponsePayload: {"cmdId":"CMD-BIA-1","errorCode":0} --status: 200');
  line('INFO', '[Module: HTTP] [Method: GET] [URL: https://gia.lap/bia/hai] --RequestPayload: {"cmdId":"CMD-BIA-2"}');
  line('INFO', '[Module: HTTP] [Method: GET] [URL: https://gia.lap/bia/hai] --ResponsePayload: {"cmdId":"CMD-BIA-2","errorCode":404} --status: 404');

  // --- Đảo thứ tự: log ghi ResponsePayload TRƯỚC RequestPayload của chính nó. Đo trên ba log thật:
  // 0 / 3 / 16 cặp như vậy, và cặp nào cũng lệch đúng MỘT dòng. Ghép theo thứ tự dòng thô thì call
  // này bị báo "không có response" rồi chính response đó lại sinh thêm một hàng call ma.
  line('INFO', '[Module: HTTP] [Method: POST] [URL: https://gia.lap/bia/nguoc] --ResponsePayload: {"cmdId":"CMD-BIA-3","errorCode":0} --status: 200');
  line('INFO', '[Module: HTTP] [Method: POST] [URL: https://gia.lap/bia/nguoc] --RequestPayload: {"cmdId":"CMD-BIA-3"}');

  // --- Response mồ côi: log bị cắt đầu nên request của nó nằm ngoài file (log uat1 thật có 6 cái
  // như vậy). Nó không được phép cướp request của lần gọi SAU trên cùng URL.
  line('INFO', '[Module: HTTP] [Method: GET] [URL: https://gia.lap/bia/mocoi] --ResponsePayload: {"errorCode":0} --status: 200');
  line('INFO', '[Module: KhoBia] mot dong khong lien quan chen giua hai lan goi');
  line('INFO', '[Module: HTTP] [Method: GET] [URL: https://gia.lap/bia/mocoi] --RequestPayload: {"cmdId":"CMD-BIA-4"}');
  line('INFO', '[Module: HTTP] [Method: GET] [URL: https://gia.lap/bia/mocoi] --ResponsePayload: {"cmdId":"CMD-BIA-4","errorCode":0} --status: 200');

  // --- ERROR/WARNING để có nhóm vấn đề; hai dòng ERROR cùng bản chất chỉ khác số
  line('ERROR', '[Module: ThanhPhanBia] khong tai duoc muc 41 tu kho bia');
  line('ERROR', '[Module: ThanhPhanBia] khong tai duoc muc 87 tu kho bia');
  line('WARNING', '[Module: ThanhPhanBia] tra ve rong, dung tam gia tri mac dinh');

  // --- Dòng TIẾP NỐI không có timestamp: stack trace trên log thật trải ra nhiều dòng, chỉ dòng đầu
  // có giờ. Đo trên ba log thật: 240 / 180 / 85 dòng không có giờ. Cửa sổ thời gian từng loại thẳng
  // chúng, tức bật cửa sổ quanh đúng lúc lỗi nổ ra thì mất luôn phần dưới của stack trace đó.
  lines.push('    at KhoBia.taiMuc(KhoBia.gialap:41)');
  lines.push('    at ThanhPhanBia.ve(ThanhPhanBia.gialap:87)');
  lines.push('');

  // --- Màn cuối của phiên 1. Bước màn kế tiếp nằm ở PHIÊN SAU, cách cả tiếng đồng hồ: đo vắt qua thì
  // ra "ở trên màn hơn một tiếng" trong khi app đã bị tắt. Bug thật đã gặp trên log production.
  tracker('auto_screen_navigated', 'app_id=vn.gia.lap, screen_name=ManHinhCuoiPhien, pre_screen_name=ManHinhMot');

  // --- khoảng lặng 6s, nhưng là do APP XUỐNG NỀN chứ không phải app treo. Trạng thái app chỉ nằm ghép
  // trong dòng MQTT — đó là chỗ duy nhất trong log thật nói ra điều này.
  line('INFO', '[Module: MQTT-GIA-LAP] MQTT Connection not satisfy gia.lap:8883 - keepAliveInSecond: 60 - ' +
    'clientId: BIA-0001 - appState: BACKGROUND - isReady: false');
  line('INFO', '[Module: GiaLapIdle] khong co gi xay ra', 6000);
  line('INFO', '[Module: MQTT-GIA-LAP] MQTT Connection satisfy gia.lap:8883 - keepAliveInSecond: 60 - ' +
    'clientId: BIA-0001 - appState: FOREGROUND - isReady: true');

  // --- phiên thứ hai, ghi ĐỦ cả ba mốc khởi động cách nhau vài trăm ms như log thật.
  // Đếm từng mốc thì một lần mở app thành ba phiên — đây là bug thật đã gặp.
  line('INFO', '[Module: GiaLapDb] MomoDatabase init OK', 3600000);
  line('INFO', '@@ appSync >> syncStartApp', 369);
  line('INFO', '[Module: GiaLapDb] [PERF] SyncAppFeature, start', 382);
  tracker('auto_screen_navigated', 'app_id=vn.gia.lap, screen_name=ManHinhBa, pre_screen_name=ManHinhMot');
  tracker('feature_source', 'action=start_feature, from=tinh_nang_mot, to=tinh_nang_hai');

  // --- event có tên nhưng KHÔNG có params (log thật có dạng "... does not exist in Whitelist")
  line('INFO', '[Module: MoMoTracker] event: su_kien_bia does not exist in Whitelist');

  // --- Miniapp tải lỗi: stage lấy từ AppEvent.FeatureMiniAppLoad.Stage trong source app.
  // Ghi ở mức INFO nên phần gom nhóm lỗi không đếm được, nhưng đây là thứ user NHÌN THẤY.
  tracker('feature_miniapp_load', 'app_id=vn.gia.lap, feature_code=tinh_nang_bia, stage=miniapp_load_start');
  tracker('feature_miniapp_load', 'app_id=vn.gia.lap, feature_code=tinh_nang_bia, stage=scr_fail_loading_miniapp');
  tracker('feature_miniapp_load', 'app_id=vn.gia.lap, feature_code=tinh_nang_bia, stage=miniapp_web_js_crash');

  // --- HAI màn đều ghi screen_name=result nhưng là HAI lớp khác nhau. Chỉ nhìn screen_name thì chúng
  // bị gom làm một hàng, mất sạch cái để phân biệt. Đuôi của momoClassDiscriminator mới là tên thật.
  tracker('service_screen_displayed', 'screen_name=result, service_name=ket_qua, ' +
    'momoClassDiscriminator=vn.gia.lap.journey.KetQuaRevampScreenDisplayed, status=PROCESSING');
  tracker('service_screen_displayed', 'screen_name=result, service_name=ket_qua, ' +
    'momoClassDiscriminator=vn.gia.lap.journey.KetQuaWidgetDisplayed, status=PROCESSING', 900);
  // Lớp chứa THAM SỐ chứ không phải tên màn — không được lấy làm tên.
  tracker('service_screen_displayed', 'screen_name=ManHinhThuong, service_name=thuong, ' +
    'momoClassDiscriminator=vn.gia.lap.model.KhuyenMaiEventParams', 900);

  // --- Thời gian TẢI màn: số có sẵn trong log, khác hẳn "ở lâu trên màn"
  tracker('auto_screen_displayed', 'screen_name=ManHinhCham, state=load, duration=4200, component_name=Screen');
  tracker('auto_screen_displayed', 'screen_name=ManHinhCham, state=load, duration=2100, component_name=Screen');
  tracker('auto_load_progress_tracked', 'screen_name=ManHinhNhanh, end_point=ManHinhNhanh, indicator_type=screen, duration=300');
  // state=interaction thì KHÔNG phải thời gian tải -> không được tính
  tracker('auto_screen_displayed', 'screen_name=ManHinhKhac, state=interaction, duration=9999');

  // --- Nhiễu từ chính lớp đo lường: ghi ở mức ERROR nên ĐANG lọt vào nhóm chữ ký và làm nhiễu.
  // Ba dòng, hai chữ ký khác nhau. Trên log production thật đây chiếm 51% số dòng ERROR.
  line('ERROR', '[Module: Grafana] @@ grafana >> DefaultRequestQueue >> handleError >> error: kotlin.Exception');
  line('ERROR', '[AppID: vn.gia.lap] [KetQua] GrafanaTrace.stop:: no traceId GrafanaMetric(flow=luong_bia, step=buoc_bia)');
  line('ERROR', '[AppID: vn.gia.lap] [KetQua] GrafanaTrace.stop:: no traceId GrafanaMetric(flow=luong_bia, step=buoc_khac)');

  // --- Grafana trace. traceFail ở mức INFO nên không nhóm chữ ký nào đếm được.
  grafana('startTrace', 'flow=luong_bia, step=buoc_mot_start, appId=vn.gia.lap, errorCode=null, errorMessage=null');
  grafana('traceSuccess', 'flow=luong_bia, step=buoc_mot_success, appId=vn.gia.lap, errorCode=null, errorMessage=null');

  // Một sự cố "hạ tầng": CÙNG errorMessage nhưng ở HAI app khác nhau -> phải về MỘT hàng, apps=2
  grafana('traceFail', 'flow=vn.gia.lapmot, step=miniapp.lay_ban_fail, appId=vn.gia.lapmot, errorCode=500.0, errorMessage=500 - khong tim thay ban nao');
  grafana('traceFail', 'flow=vn.gia.laphai, step=miniapp.lay_ban_fail, appId=vn.gia.laphai, errorCode=500.0, errorMessage=500 - khong tim thay ban nao');

  // Hai lỗi KHÔNG có errorMessage, cùng errorCode nhưng KHÁC bước -> phải là HAI hàng riêng
  grafana('traceFail', 'flow=nen_tang, step=ManHinhMot_goi_api_ALPHA_fail, appId=vn.gia.lap, errorCode=200.0, errorMessage=null');
  grafana('traceFail', 'flow=nen_tang, step=ManHinhHai_goi_api_BETA_fail, appId=vn.gia.lap, errorCode=200.0, errorMessage=null');

  // --- CẤU HÌNH: một đại diện cho mỗi nguồn mà tab Cấu hình biết đọc.
  // Giá trị đều bịa, nhưng DẠNG dòng thì giữ y hệt log thật (đó là thứ bộ đọc dựa vào).
  line('INFO', '[Module: BaoLoiBia] Persist CauHinhBia key=cau_hinh_bia raw={"enable":true,"tiLe":0.3,"danhSach":[]}');
  line('INFO', '[Module: SYNC, FEATURE] reddotFlow getLocalized > webadmin config tabbar_bia 200K');
  line('INFO', '[Module: KhoCauHinh] @@ configs >> fetchConfig >> url: https://gia.lap/json/bang_loi_bia.json');
  line('INFO', '@@ abTesting >> logTagConfig :: config: ABTestingExpTag(namespace=BIA_THU_NGHIEM, ' +
    'exp_definition=bia, exp_name=bia.2, tag=nhanh_moi, last_updated=1740000000000000)');
  // Cùng namespace, ghi lại lần hai với CÙNG giá trị -> chỉ được tính là MỘT giá trị
  line('INFO', '@@ abTesting >> getABTestFlow :: namespace: BIA_THU_NGHIEM - config: ' +
    'ABTestingExpTag(namespace=BIA_THU_NGHIEM, exp_definition=bia, exp_name=bia.2, tag=nhanh_moi, ' +
    'last_updated=1740000000000000) - defaultFlow: mac_dinh - cacheOnly: false');
  // Khoá này ĐỔI giá trị giữa phiên -> phải ra "2 giá trị khác nhau"
  line('INFO', '[Module: BaoLoiBia] Persist CauHinhBia key=cau_hinh_doi raw={"enable":true}');
  line('INFO', '[Module: BaoLoiBia] Persist CauHinhBia key=cau_hinh_doi raw={"enable":false}', 200);
  // Call BE xin cấu hình: nằm ở module HTTP nên phải ra ở mục riêng, không lẫn vào bảng khoá
  line('INFO', '[Module: HTTP] [Method: GET] [URL: https://gia.lap/user-config/lay-bia] ' +
    '--RequestPayload: {"cmdId":"CMD-BIA-3"}');
  line('INFO', '[Module: HTTP] [Method: GET] [URL: https://gia.lap/user-config/lay-bia] ' +
    '--ResponsePayload: {"cmdId":"CMD-BIA-3","errorCode":0} --status: 200');
  // MỒI NHỬ: payload dài mở đầu bằng "{" rồi mới có chữ displayConfig -> KHÔNG được coi là cấu hình
  line('INFO', '[ManBia] onMoKhuyenMai === {man=ManBia, displayConfig=BiaOffline, danhSach=[1,2,3], ' +
    'ghiChu=day la payload khuyen mai chu khong phai cau hinh, dai qua 120 ky tu de giong log that}');
  // "configure" là động từ báo xong một bước, không mang giá trị cấu hình -> cũng không được nhận
  line('INFO', '[Module: DonDep] @@ bia >> DonDepBia >> configure xong [tongMs=1ms, buocMs=0ms]');

  return lines.slice();
}

module.exports = { build };
