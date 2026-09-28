# Finance in the Age of AI

Columbia Business School의 B8403 수업 웹사이트입니다. 배포하지 않은 로컬 Jekyll 사이트입니다.

## 로컬 미리보기

```sh
cd /Users/so2735/Github/ai-finance-cbs
./tools/preview.sh
```

브라우저에서 `http://127.0.0.1:4173`을 엽니다. `Ctrl+C`로 서버를 종료합니다.

```sh
./tools/build.sh
```

정적 파일은 `_site/`에 생성됩니다. Node 빌드 단계와 추가 Jekyll 플러그인은 없습니다.
`tools/build.sh`는 SPEC.md에 지정된 gem 경로를 사용합니다. 다른 환경에서는 설치한 Jekyll로 `jekyll build`를 실행하면 됩니다.

## 내용 수정

페이지 내용은 루트의 HTML 파일에 있습니다. 주차별 내용은 `_data/weeks.yml`, 과제는 `_data/milestones.yml`에 있습니다.
공통 탐색 메뉴는 `_includes/sidebar.html`에 있습니다. Canvas와 Office hours URL은 아직 TBA입니다.

홈 화면의 다음 수업과 공지는 `_data/home.yml`에서 수정합니다. `up_next.week`는 `_data/weeks.yml`의 주차 번호입니다.
제목과 과제 링크는 해당 주차에서 자동으로 가져옵니다. `up_next.date`는 날짜이며, 미정이면 `TBA`를 유지합니다.
`announcements`에 `text`와 선택 항목인 `date`를 넣으면 공지가 표시됩니다. 빈 목록이면 공지가 없다는 문구를 표시합니다.

`assets/cbs-logo.svg`는 회색 임시 로고 자리입니다. 공식 가로형 로고를 받으면 같은 경로의 파일을 교체합니다.
교체할 때 `_includes/sidebar.html`의 임시 로고 안내 주석과 `alt` 문구도 수정합니다.
페이지별 삽화는 `assets/scenes/`에 있습니다. 선택 도구인 `tools/draw-scenes.py`는 Python fontTools와 로컬 Inter 글꼴로 삽화를 다시 만듭니다.
이 도구는 일반 사이트 빌드에 필요하지 않으며, 기존 로고 파일을 덮어쓰지 않습니다.

검토 내용은 `NOTES.md`, 구조 설명은 `LEARN.md`, 화면 캡처는 `evidence/`에 있습니다.
검토 파일과 원본 기획서는 `_site/`에서 제외됩니다. GitHub 원격 저장소나 조직을 만들지 않았습니다.
