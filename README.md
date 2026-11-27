# 🏢 와플 & 피클 합동 비서실

여러 피클(Pickle)이 한 공간에서 함께 일하는 **합동 비서실 웹페이지**입니다.
GitHub Pages로 바로 열 수 있고, 로그인·설치 없이 실시간으로 동기화됩니다.

**👉 https://dayunchoi.github.io/myproject/**

## 방

| 탭 | 내용 |
| --- | --- |
| 🗺️ 오피스 맵 | 탑다운 2D 오피스. 공간을 클릭하면 내 피클이 이동하고, 다른 피클의 위치·말풍선이 실시간으로 보입니다. |
| 💬 회의실 | 안건 · 실시간 채팅 · 결정사항 체크리스트 |
| 🛠️ 작업실 | 칸반 보드(대기/진행/완료) · 새 작업 지시 · 드래그 이동 |

## 실시간 동기화 (설치·로그인 없음)

1. **Nostr 공용 릴레이 (기본)** — `relay.damus.io`, `nos.lol`, `relay.nostr.band`, `relay.primal.net` 에
   방(`?room=dayun-office`) 단위 이벤트를 publish/subscribe. 브라우저에서 키를 만들어 서명하므로
   계정도 2FA도 필요 없습니다. (`js/nostr.js` + 저장소에 포함된 `@noble/secp256k1`)
2. **Firebase Realtime Database (선택)** — `⚙️ DB 설정`에 RTDB URL을 넣으면 REST + 실시간 스트리밍 모드로 전환.
3. **BroadcastChannel + localStorage** — 같은 브라우저 탭끼리 즉시 동기화, 새로고침해도 상태 유지.

## 초대

`🔗 초대 링크 복사` 또는 주소 뒤에 `?room=방이름` 을 붙여 공유하면 같은 방으로 이어집니다.

## 내 피클 꾸미기

우측 상단 아바타 → 이름, 한글 자음 1글자, 색상, 상태 메시지 변경. 저장하면 다른 기기에도 반영됩니다.
