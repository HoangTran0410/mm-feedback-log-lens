/*
File: test/fixture.js
Created At: 2026-09-10 10:00:00 +07:00
Created By: AI
AI Agent: Claude Code
Model: claude-opus-5
*/
// AI-GENERATED START — sinh log GIA de test. Khong mot dong nao lay tu log that:
// .gitignore cam commit *.yml/*.log vi chung chua du lieu nguoi dung. Fixture nay chi tai tao
// nhung DAC TINH da gap tren log that (ghi lap, trace_id trung, timestamp lui, popup o muc INFO),
// con noi dung thi bia sach.

let clock = Date.UTC(2026, 0, 2, 3, 0, 0); // 10:00:00 GMT+7

function stamp(ms) {
  const d = new Date(ms + 7 * 3600000);
  const p = (n, w) => String(n).padStart(w || 2, '0');
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate()) + ' ' +
    p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + ':' +
    p(d.getUTCMilliseconds(), 3) + ' GMT+07:00';
}

const lines = [];

// advance = 0 cho phep dat hai dong cung moc thoi gian (log that co ca dong timestamp lui).
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

  // --- man hinh + cham thuong
  tracker('auto_screen_navigated', 'app_id=vn.gia.lap, screen_name=ManHinhMot, pre_screen_name=ManHinhGoc, action=push');
  tracker('service_button_clicked', 'service_name=dich_vu_bia, screen_name=man_mot, button_name=nut_bia');

  // --- GHI LAP: cung mot thao tac, hai dong cach 2ms -> phai gop thanh 1 buoc count=2
  tracker('service_button_clicked', 'service_name=dich_vu_bia, screen_name=man_hai, button_name=nut_lap, user_type=A', 500);
  tracker('service_button_clicked', 'service_name=dich_vu_bia, screen_name=man_hai, button_name=nut_lap, user_type=B', 2);

  // --- CACH XA: cung nhan nhung cach 5s -> KHONG duoc gop
  tracker('service_button_clicked', 'service_name=dich_vu_bia, screen_name=man_hai, button_name=nut_lap, user_type=A', 5000);

  // --- popup o muc INFO: thu ma phan gom nhom loi khong bao gio thay
  tracker('auto_popup_displayed', 'app_id=vn.gia.lap, screen_name=ManHinhMot, action=open, title=Popup Bia Canh Bao');

  // --- ops: MOT call nhung log ghi thanh HAI dong cung trace_id -> dedupe con 1
  tracker('ops_request_be', 'api=API_BIA_MOT, api_path=bia/mot, trace_id=TRACE-BIA-0001, screen_name=ManHinhMot');
  tracker('ops_receive_be', 'api=API_BIA_MOT, api_path=bia/mot, trace_id=TRACE-BIA-0001, status=fail, error_code=500, duration=120.0, screen_name=ManHinhMot');
  tracker('ops_receive_be', 'api=API_BIA_MOT, api_path=bia/mot, trace_id=TRACE-BIA-0001, status=fail, error_code=500, duration=121.0, screen_name=ManHinhMot', 1);

  // --- hai call fail RIENG BIET, khac trace_id, cach nhau 300ms:
  // buoc fail KHONG duoc gop du sat nhau, vi moi trace_id la mot call that
  tracker('ops_request_be', 'api=API_BIA_HAI, api_path=bia/hai, trace_id=TRACE-BIA-0002, screen_name=ManHinhMot');
  tracker('ops_receive_be', 'api=API_BIA_HAI, api_path=bia/hai, trace_id=TRACE-BIA-0002, status=fail, error_code=404, duration=90.0, screen_name=ManHinhMot');
  tracker('ops_receive_be', 'api=API_BIA_HAI, api_path=bia/hai, trace_id=TRACE-BIA-0003, status=fail, error_code=404, duration=91.0, screen_name=ManHinhMot', 300);

  // --- mot call thanh cong, de apiTotal != apiFail
  tracker('ops_receive_be', 'api=API_BIA_BA, api_path=bia/ba, trace_id=TRACE-BIA-0004, status=success, error_code=0, duration=45.0');

  // --- gia tri co dau phay ben trong va map long nhau: phep thu cho parseKeyValueMap
  tracker('auto_screen_displayed', 'screen_name=ManHinhHai, duration=1500, bundle_sof=1,2, last_component={ten=NutBia, nhan=[a, b]}');

  // --- HTTP kieu dong [Method:] — nguon khac han voi ops_*
  line('INFO', '[Module: HTTP] [Method: POST] [URL: https://gia.lap/bia/mot] --RequestPayload: {"cmdId":"CMD-BIA-1"}');
  line('INFO', '[Module: HTTP] [Method: POST] [URL: https://gia.lap/bia/mot] --ResponsePayload: {"cmdId":"CMD-BIA-1","errorCode":0} --status: 200');
  line('INFO', '[Module: HTTP] [Method: GET] [URL: https://gia.lap/bia/hai] --RequestPayload: {"cmdId":"CMD-BIA-2"}');
  line('INFO', '[Module: HTTP] [Method: GET] [URL: https://gia.lap/bia/hai] --ResponsePayload: {"cmdId":"CMD-BIA-2","errorCode":404} --status: 404');

  // --- ERROR/WARNING de co nhom van de; hai dong ERROR cung ban chat chi khac so
  line('ERROR', '[Module: ThanhPhanBia] khong tai duoc muc 41 tu kho bia');
  line('ERROR', '[Module: ThanhPhanBia] khong tai duoc muc 87 tu kho bia');
  line('WARNING', '[Module: ThanhPhanBia] tra ve rong, dung tam gia tri mac dinh');

  // --- khoang lang 6s
  line('INFO', '[Module: GiaLapIdle] khong co gi xay ra', 6000);

  // --- phien thu hai
  line('INFO', '[Module: GiaLapDb] MomoDatabase init OK', 500);
  tracker('auto_screen_navigated', 'app_id=vn.gia.lap, screen_name=ManHinhBa, pre_screen_name=ManHinhMot');
  tracker('feature_source', 'action=start_feature, from=tinh_nang_mot, to=tinh_nang_hai');

  // --- event co ten nhung KHONG co params (log that co dang "... does not exist in Whitelist")
  line('INFO', '[Module: MoMoTracker] event: su_kien_bia does not exist in Whitelist');

  // --- Miniapp tai loi: stage lay tu AppEvent.FeatureMiniAppLoad.Stage trong source app.
  // Ghi o muc INFO nen phan gom nhom loi khong dem duoc, nhung day la thu user NHIN THAY.
  tracker('feature_miniapp_load', 'app_id=vn.gia.lap, feature_code=tinh_nang_bia, stage=miniapp_load_start');
  tracker('feature_miniapp_load', 'app_id=vn.gia.lap, feature_code=tinh_nang_bia, stage=scr_fail_loading_miniapp');
  tracker('feature_miniapp_load', 'app_id=vn.gia.lap, feature_code=tinh_nang_bia, stage=miniapp_web_js_crash');

  // --- Thoi gian TAI man: so co san trong log, khac han "o lau tren man"
  tracker('auto_screen_displayed', 'screen_name=ManHinhCham, state=load, duration=4200, component_name=Screen');
  tracker('auto_screen_displayed', 'screen_name=ManHinhCham, state=load, duration=2100, component_name=Screen');
  tracker('auto_load_progress_tracked', 'screen_name=ManHinhNhanh, end_point=ManHinhNhanh, indicator_type=screen, duration=300');
  // state=interaction thi KHONG phai thoi gian tai -> khong duoc tinh
  tracker('auto_screen_displayed', 'screen_name=ManHinhKhac, state=interaction, duration=9999');

  // --- Nhieu tu chinh lop do luong: ghi o muc ERROR nen ĐANG lot vao nhom chu ky va lam nhieu.
  // Ba dong, hai chu ky khac nhau. Tren log production that day chiem 51% so dong ERROR.
  line('ERROR', '[Module: Grafana] @@ grafana >> DefaultRequestQueue >> handleError >> error: kotlin.Exception');
  line('ERROR', '[AppID: vn.gia.lap] [KetQua] GrafanaTrace.stop:: no traceId GrafanaMetric(flow=luong_bia, step=buoc_bia)');
  line('ERROR', '[AppID: vn.gia.lap] [KetQua] GrafanaTrace.stop:: no traceId GrafanaMetric(flow=luong_bia, step=buoc_khac)');

  // --- Grafana trace. traceFail o muc INFO nen khong nhom chu ky nao dem duoc.
  grafana('startTrace', 'flow=luong_bia, step=buoc_mot_start, appId=vn.gia.lap, errorCode=null, errorMessage=null');
  grafana('traceSuccess', 'flow=luong_bia, step=buoc_mot_success, appId=vn.gia.lap, errorCode=null, errorMessage=null');

  // Mot su co "ha tang": CUNG errorMessage nhung o HAI app khac nhau -> phai ve MOT hang, apps=2
  grafana('traceFail', 'flow=vn.gia.lapmot, step=miniapp.lay_ban_fail, appId=vn.gia.lapmot, errorCode=500.0, errorMessage=500 - khong tim thay ban nao');
  grafana('traceFail', 'flow=vn.gia.laphai, step=miniapp.lay_ban_fail, appId=vn.gia.laphai, errorCode=500.0, errorMessage=500 - khong tim thay ban nao');

  // Hai loi KHONG co errorMessage, cung errorCode nhung KHAC buoc -> phai la HAI hang rieng
  grafana('traceFail', 'flow=nen_tang, step=ManHinhMot_goi_api_ALPHA_fail, appId=vn.gia.lap, errorCode=200.0, errorMessage=null');
  grafana('traceFail', 'flow=nen_tang, step=ManHinhHai_goi_api_BETA_fail, appId=vn.gia.lap, errorCode=200.0, errorMessage=null');

  // --- CAU HINH: mot dai dien cho moi nguon ma tab Cau hinh biet doc.
  // Gia tri deu bia, nhung DANG dong thi giu y het log that (do la thu bo doc dua vao).
  line('INFO', '[Module: BaoLoiBia] Persist CauHinhBia key=cau_hinh_bia raw={"enable":true,"tiLe":0.3,"danhSach":[]}');
  line('INFO', '[Module: SYNC, FEATURE] reddotFlow getLocalized > webadmin config tabbar_bia 200K');
  line('INFO', '[Module: KhoCauHinh] @@ configs >> fetchConfig >> url: https://gia.lap/json/bang_loi_bia.json');
  line('INFO', '@@ abTesting >> logTagConfig :: config: ABTestingExpTag(namespace=BIA_THU_NGHIEM, ' +
    'exp_definition=bia, exp_name=bia.2, tag=nhanh_moi, last_updated=1740000000000000)');
  // Cung namespace, ghi lai lan hai voi CUNG gia tri -> chi duoc tinh la MOT gia tri
  line('INFO', '@@ abTesting >> getABTestFlow :: namespace: BIA_THU_NGHIEM - config: ' +
    'ABTestingExpTag(namespace=BIA_THU_NGHIEM, exp_definition=bia, exp_name=bia.2, tag=nhanh_moi, ' +
    'last_updated=1740000000000000) - defaultFlow: mac_dinh - cacheOnly: false');
  // Khoa nay DOI gia tri giua phien -> phai ra "2 gia tri khac nhau"
  line('INFO', '[Module: BaoLoiBia] Persist CauHinhBia key=cau_hinh_doi raw={"enable":true}');
  line('INFO', '[Module: BaoLoiBia] Persist CauHinhBia key=cau_hinh_doi raw={"enable":false}', 200);
  // Call BE xin cau hinh: nam o module HTTP nen phai ra o muc rieng, khong lan vao bang khoa
  line('INFO', '[Module: HTTP] [Method: GET] [URL: https://gia.lap/user-config/lay-bia] ' +
    '--RequestPayload: {"cmdId":"CMD-BIA-3"}');
  line('INFO', '[Module: HTTP] [Method: GET] [URL: https://gia.lap/user-config/lay-bia] ' +
    '--ResponsePayload: {"cmdId":"CMD-BIA-3","errorCode":0} --status: 200');
  // MOI NHU: payload dai mo dau bang "{" roi moi co chu displayConfig -> KHONG duoc coi la cau hinh
  line('INFO', '[ManBia] onMoKhuyenMai === {man=ManBia, displayConfig=BiaOffline, danhSach=[1,2,3], ' +
    'ghiChu=day la payload khuyen mai chu khong phai cau hinh, dai qua 120 ky tu de giong log that}');
  // "configure" la dong tu bao xong mot buoc, khong mang gia tri cau hinh -> cung khong duoc nhan
  line('INFO', '[Module: DonDep] @@ bia >> DonDepBia >> configure xong [tongMs=1ms, buocMs=0ms]');

  return lines.slice();
}

module.exports = { build };
// AI-GENERATED END
