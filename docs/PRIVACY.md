# Agent Council Privacy Policy

Draft for publisher review · 2026-11-11 · Windows desktop app and its optional browser companion

## English

**Publisher** — Jiwon Min. Agent Council runs a local engine on your PC. It uses your chosen third-party AI command-line tools to perform coding and review. Agent Council has no publisher-hosted account, chat storage, advertising or analytics service.

**On your PC.** The engine saves project and reference paths, preferences, drafts, conversation history, agent outputs, job events and token counts in local app data. The Store build keeps this data and its WebView2 profile in the Windows package's LocalState. The local SQLite database uses normal Windows file permissions and has no separate database encryption. History remains on the PC until the local app data is cleared.

**AI providers.** When you send a request, the app gives participating tools your request and relevant context, which can include earlier messages, project paths, code changes and other agents' results. The tools may read project files and send code, file content or context to their own providers. This can include personal or confidential information if present in the inputs or accessible files. The recipients depend on your tools and their configuration. Their terms, privacy policies, data retention and account settings apply. Review your selected tools, folders and execution permissions before sending. Removing a participant affects future jobs and cannot recall data a provider has already received.

**Account usage.** The engine tries to obtain account quota information from the supported tools and their providers when it starts, periodically while it is running, after work finishes and when you refresh usage. This can happen for a tool that is outside the current team. The engine may read an existing local CLI or IDE sign-in, use provider credentials to authenticate quota requests to the matching provider and refresh a Gemini access token with Google. It does not display those credentials or send them to the publisher. To stop the app from using an existing local sign-in for these lookups, stop its engine or sign out of the relevant CLI or IDE. Closing the desktop window can leave the engine running.

**Paired browsers.** Phone access is off until enabled on the PC. A browser can use it after the PC approves the pairing. The PC stores the device label, grant, a hash of the device credential and its draft. The browser uses an expiring HttpOnly authentication cookie and may temporarily retain its draft for input recovery. Paired devices can access the approved project's history, results, usage and eligible file previews, and can request work if that grant is enabled. If you configure Tailscale Serve, traffic uses your configured private HTTPS route. Revoke a device or turn off phone access from the desktop app. Clear the companion site's browser data to remove that browser's local copy.

**Your controls.** Read your project history, draft and results in the app. To clear the Store app's local data, finish active work and use the Windows app reset option where available, or remove the package. Your external projects and provider accounts are managed separately. Use the relevant provider to manage its copies and account rights. Windows, Microsoft Store and other services you choose to use have their own data practices.

**Contact and reports.** Contact the publisher through [Agent Council support](https://github.com/jwjp/agent-council/issues), including to report an inappropriate AI response. The issue tracker is public. Describe the problem using a redacted summary and omit prompts, logs, account details, source code and other confidential information.

## 한국어

**게시자** — Jiwon Min. Agent Council은 사용자의 PC에서 로컬 엔진을 실행합니다. 사용자가 선택한 외부 AI 명령줄 도구를 통해 코딩과 검수를 진행합니다. 게시자가 운영하는 별도 계정, 대화 저장 서버, 광고 또는 분석 서비스는 없습니다.

**PC에 저장하는 정보.** 엔진은 프로젝트와 참고 폴더의 경로, 설정, 초안, 대화, 에이전트 출력, 작업 기록과 토큰 수를 로컬 앱 데이터에 저장합니다. Store판은 Windows 패키지의 LocalState에 이 데이터와 WebView2 프로필을 저장합니다. 로컬 SQLite 데이터베이스에는 Windows 파일 권한이 적용되며 별도의 데이터베이스 암호화는 적용되지 않습니다. 앱 데이터를 지울 때까지 PC에 기록이 남습니다.

**AI 제공사에 전달하는 정보.** 요청을 보내면 참여 도구에 요청과 관련 맥락을 전달합니다. 여기에는 이전 대화, 프로젝트 경로, 코드 변경 내용과 다른 에이전트의 결과가 포함될 수 있습니다. 도구가 프로젝트 파일을 읽어 코드나 파일 내용을 해당 제공사에 전달할 수 있습니다. 입력이나 파일에 개인정보 또는 기밀정보가 있으면 함께 전달될 수 있습니다. 수신처는 사용자가 선택한 도구와 설정에 따라 달라지며, 각 제공사의 약관, 개인정보처리방침, 보관 정책과 계정 설정이 적용됩니다. 요청을 보내기 전에 도구, 폴더와 실행 권한을 확인하세요. 참여자를 해제하면 이후 작업에 반영됩니다. 제공사에 이미 전달한 데이터는 제공사에서 관리해야 합니다.

**계정 사용량.** 엔진이 시작될 때, 실행 중 주기적으로, 작업이 끝났을 때, 또는 사용량을 새로고침할 때 지원하는 도구와 제공사에 한도를 조회합니다. 현재 작업에 참여하지 않는 도구도 조회할 수 있습니다. PC에 저장된 CLI나 IDE 로그인 정보를 읽어 해당 제공사의 조회 요청을 인증할 수 있으며, Gemini 액세스 토큰 갱신은 Google을 통해 이뤄질 수 있습니다. 로그인 정보는 화면에 표시하거나 게시자에게 전송하지 않습니다. 조회를 중지하려면 엔진을 종료하거나 해당 CLI 또는 IDE에서 로그아웃하세요. 창을 닫아도 엔진은 계속 실행될 수 있습니다.

**연결된 브라우저.** 휴대폰 연결은 PC에서 기능을 켜고 연결 요청을 승인한 후 사용할 수 있습니다. PC에는 기기 이름, 부여한 권한, 기기 인증 정보의 해시와 기기 초안이 저장됩니다. 브라우저는 만료 시간이 있는 HttpOnly 인증 쿠키를 사용하며 입력 복구를 위해 초안을 임시 저장할 수 있습니다. 연결 기기는 승인된 프로젝트의 기록, 결과, 사용량과 허용된 파일 미리보기에 접근할 수 있습니다. 작업 권한을 부여한 경우 요청도 보낼 수 있습니다. Tailscale Serve를 설정하면 사용자가 구성한 비공개 HTTPS 경로를 사용합니다. 데스크톱 앱에서 기기 연결을 해제하거나 기능을 끌 수 있으며, 브라우저에 남은 정보는 해당 사이트의 데이터를 지워 삭제할 수 있습니다.

**열람과 삭제.** 프로젝트 대화, 초안과 결과는 앱에서 열람할 수 있습니다. Store판의 로컬 데이터를 지우려면 진행 중인 작업을 마친 뒤 Windows에서 앱 초기화 기능을 사용하거나 패키지를 제거하세요. 외부 프로젝트와 제공사 계정은 별도로 관리됩니다. 제공사가 보유한 데이터와 계정 관련 권리는 해당 제공사에서 관리할 수 있습니다. Windows, Microsoft Store 및 사용자가 선택한 외부 서비스에는 각 서비스의 데이터 정책이 적용됩니다.

**문의와 신고.** 개인정보 문의나 부적절한 AI 응답 신고는 [Agent Council 지원](https://github.com/jwjp/agent-council/issues)으로 접수할 수 있습니다. 공개 이슈이므로 식별 정보를 제거한 요약만 작성하고 프롬프트 원문, 로그, 계정 정보, 소스 코드와 기타 기밀정보는 올리지 마세요.
