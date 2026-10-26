# Nhớ nha Xuda

Ứng dụng cá nhân để ghi nhanh việc cần nhớ, ghi chú, ảnh và bản ghi âm. App được làm bằng Expo Router và React Native, ưu tiên iPhone/iPad.

## Chạy trong môi trường phát triển

```sh
cd app
pnpm install
pnpm start
```

## Bản web cài lên màn hình chính

Ứng dụng có manifest và icon PWA trong `public/`. Workflow tại `.github/workflows/deploy-pages.yml` tự build rồi deploy khi có push lên `main` hoặc `master`. Trong repository, bật **Settings → Pages → Source: GitHub Actions**.

Mở link GitHub Pages bằng Safari trên iPhone, chọn **Chia sẻ → Thêm vào Màn hình chính**. Dữ liệu PWA được lưu cục bộ trong trình duyệt trên thiết bị và không tự đồng bộ với bản iOS native.

Một số khả năng phụ thuộc native như chuyển giọng nói thành chữ và thông báo có thể không hoạt động đầy đủ trên web. Google Calendar chưa được kết nối.

## Build iOS native

Ứng dụng dùng module nhận dạng giọng nói native. Build iOS từ Windows cần EAS Build, tài khoản Expo và cấu hình ký Apple phù hợp.

## Kiểm tra

```sh
pnpm exec eslint .
pnpm exec tsc --noEmit
pnpm exec expo export --platform web
```

