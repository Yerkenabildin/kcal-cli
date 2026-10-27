# kcal

`kcal` — локальный CLI для каталога продуктов, рецептов, целей по питанию и дневника
приёмов пищи. Программа рассчитана прежде всего на использование человеком через терминал и
агентом через стабильный JSON-интерфейс.

SQLite является единственным источником истины. Внешние сервисы используются только для поиска
продуктов и распознавания этикеток:

- **Open Food Facts** — поиск магазинных продуктов, прежде всего по штрихкоду;
- **YAZIO** — дополнительный поиск по названию и штрихкоду через неофициальный private API;
- **OpenRouter** — распознавание КБЖУ с фотографии, когда штрихкод не дал пригодного результата.

Поиск ничего не импортирует вручную. Когда найденный снаружи продукт впервые добавляется в
дневник, рецепт, избранное или сохраняется командой `item save`, `kcal` автоматически и
транзакционно записывает его в локальную базу, сохраняя исходный ID.

> [!WARNING]
> Интеграция с YAZIO использует частный, неофициальный API. Она может перестать работать после
> изменения API или требований к версии мобильного клиента. Локальная база и остальные команды
> от YAZIO не зависят.

## Возможности

- локальные продукты с алиасами, брендом, штрихкодами, порциями, КБЖУ и клетчаткой;
- рецепты из продуктов и других рецептов с проверкой циклических ссылок;
- поиск с приоритетом проверенной локальной базы, Favorites и Recent;
- автоматическое сохранение внешних результатов при первом использовании;
- дневник по приёмам пищи с неизменяемым снимком КБЖУ;
- редактирование и мягкое удаление записей с журналом ревизий;
- дневные цели и итоги за день или диапазон дат;
- сканирование EAN, UPC, GTIN и QR локально;
- распознавание таблицы пищевой ценности через OpenRouter;
- JSON в `stdout`, структурированные ошибки в `stderr` и предсказуемые exit codes;
- идемпотентное добавление в дневник через `--op-key`.

## Требования

- Node.js 22 или новее;
- npm;
- C/C++ toolchain только на платформах, для которых у `better-sqlite3` нет готового бинарника.

## Установка

Установите опубликованный пакет из npm:

```bash
npm install --global kcal-cli
kcal --help
```

Пакет в npm: [kcal-cli](https://www.npmjs.com/package/kcal-cli)

Для разработки из рабочей копии проекта:

```bash
npm ci
npm link
kcal --help
```

Без глобального link CLI можно запускать так:

```bash
npm run kcal -- --help
node bin/kcal.mjs --help
```

Основной бинарник называется `kcal`. Бинарник `yazio` временно оставлен как deprecated alias и
запускает ту же реализацию.

## Быстрый старт

Создайте локальный продукт из JSON-файла:

```bash
kcal food create --file product.json
```

Найдите продукт, добавьте его в избранное и запишите обед:

```bash
kcal search "чечевица" --limit 10
kcal favorite add off::8712345678905 --alias "моя чечевица"
kcal diary add "моя чечевица" --amount 200 --unit g --meal lunch
kcal diary day
```

Установите дневные цели:

```bash
kcal goal set --energy 2000 --protein 120 --fat 70 --carb 220 --fiber 30
kcal goal show
```

Отсканируйте упаковку или этикетку:

```bash
export OPENROUTER_API_KEY="..."
kcal scan ./label.jpg --hint "чечевичный хлеб" --allow-ai
```

Если на изображении найден товарный штрихкод и продукт найден у провайдера, OpenRouter не
вызывается.

## Команды

### Поиск и каталог

```text
kcal search <query> [--limit 10]
kcal item show <item-id> [--amount 200 --unit g]
kcal item save <item-id>
kcal item update <item-id> --set key=value [--set key=value ...]
kcal item verify <item-id>
kcal item archive <item-id> --yes
```

Примеры:

```bash
kcal search "молоко"
kcal search 8712345678905
kcal item show off::8712345678905
kcal item show off::8712345678905 --amount 250 --unit ml
kcal item save off::8712345678905
kcal item verify off::8712345678905
kcal item archive off::8712345678905 --yes
```

`item update` принимает повторяемый `--set`. В v1 доступны поля:

```text
name
brand
state
category
basis.amount
basis.unit
nutrients.energy_kcal
nutrients.protein_g
nutrients.fat_g
nutrients.carb_g
nutrients.fiber_g
```

Например:

```bash
kcal item update scan::<uuid> \
  --set 'name=Чечевичный хлеб' \
  --set basis.amount=100 \
  --set basis.unit=g \
  --set nutrients.energy_kcal=240
```

Строковые значения с пробелами нужно заключать в кавычки. Числа, `true`, `false` и `null`
интерпретируются как JSON-значения.

### Продукты и рецепты

```text
kcal food create --file product.json
kcal recipe create --file recipe.json
kcal recipe update <recipe-id> --file recipe.json
kcal recipe show <recipe-id>
```

Вместо файла можно передать JSON через stdin:

```bash
kcal food create --file - < product.json
kcal recipe create --file - < recipe.json
```

### Избранное

```text
kcal favorite add <item-id> [--alias "моё молоко"]
kcal favorite remove <item-id>
kcal favorite list
```

Favorites изменяется только явно. Recent — не отдельный список: он вычисляется по актуальным
записям дневника и участвует в ранжировании поиска.

### Дневник

```text
kcal diary add <item-id|exact-name> --amount N --unit <g|ml|piece> --meal <slot>
    [--date YYYY-MM-DD]
    [--at "YYYY-MM-DD HH:MM:SS"]
    [--op-key key]

kcal diary day [YYYY-MM-DD]
kcal diary update <entry-id> [--amount N] [--unit unit] [--meal slot] [--at timestamp]
kcal diary remove <entry-id> --yes
kcal diary totals --start YYYY-MM-DD --end YYYY-MM-DD
```

Допустимые `meal`:

```text
breakfast | lunch | dinner | snack
```

Примеры:

```bash
# Сегодня, по точному имени или алиасу
kcal diary add "мой хлеб" --amount 90 --unit g --meal breakfast

# На конкретную дату и с ключом безопасного повтора
kcal diary add l::<uuid> \
  --amount 200 \
  --unit g \
  --meal lunch \
  --date 2026-09-24 \
  --op-key agent-message-1842

kcal diary day 2026-09-24
kcal diary totals --start 2026-09-01 --end 2026-09-30
kcal diary update e::<uuid> --amount 250 --meal dinner
kcal diary remove e::<uuid> --yes
```

Повтор `diary add` с тем же `--op-key` не создаёт вторую запись. В ответе будут
`changed: false` и `already_logged: true`.

Запись дневника содержит ID и версию item, имя, количество, единицу и полный снимок нутриентов.
Если позже изменить продукт или рецепт, уже записанная порция не пересчитывается. При
`diary update --amount` сохранённый снимок масштабируется пропорционально новому количеству.

### Цели

```text
kcal goal set [--energy N] [--protein N] [--fat N] [--carb N] [--fiber N]
kcal goal show
```

Указывается хотя бы один показатель. Неуказанные значения сохраняются от предыдущей настройки.
`diary day` возвращает `totals`, `goals` и `remaining`.
Если у части записей клетчатка неизвестна, `totals.fiber_g` остаётся числовой суммой известных
значений, а `incomplete_nutrients` содержит `fiber_g`. В таком случае `remaining.fiber_g`
остаётся `null`, потому что точный остаток до цели неизвестен. `diary totals` использует тот же
маркер для каждого дня и для всего диапазона.

### Провайдеры

```text
kcal provider yazio login --email user@example.com
kcal provider yazio status [--refresh]
kcal provider yazio logout
kcal provider openrouter status
```

Пароль YAZIO не принимается через argv. При обычном входе CLI запрашивает его скрыто в TTY:

```bash
kcal provider yazio login --email user@example.com
```

Для окружения без TTY пароль можно безопасно подать через stdin:

```bash
kcal provider yazio login --email user@example.com --password-stdin < /secure/path/password
```

В SQLite, JSON-ответы и логи пароль не записывается. На диске сохраняются только токены.

## ID

Все сущности имеют составные публичные ID:

| Префикс | Сущность | Пример |
| --- | --- | --- |
| `l::` | локальный продукт | `l::<uuid>` |
| `r::` | рецепт | `r::<uuid>` |
| `y::` | продукт YAZIO | `y::<external-id>` |
| `off::` | продукт Open Food Facts | `off::<barcode>` |
| `scan::` | распознанная этикетка | `scan::<uuid>` |
| `e::` | запись дневника | `e::<uuid>` |

Внешний ID не меняется после локального сохранения. Например, сохранённый продукт
`off::8712345678905` остаётся `off::8712345678905`, а не превращается в `l::<uuid>`.

## Как работает поиск

По названию уровни проверяются в таком порядке:

1. точное локальное имя или алиас;
2. локальные Favorites и Recent;
3. остальная локальная база через FTS5;
4. YAZIO;
5. Open Food Facts.

По штрихкоду:

1. локальная база;
2. Open Food Facts;
3. YAZIO.

Точное локальное совпадение завершает поиск без сетевого запроса. Ошибка одного внешнего
провайдера не скрывает локальные результаты и результаты другого провайдера: она возвращается в
массиве `provider_errors`.

`diary add <name>` автоматически выбирает item только при единственном точном совпадении на
первом непустом уровне приоритета. Если выбор неоднозначен, команда возвращает кандидатов и exit
code `5`. Агенту следует повторить команду с выбранным ID.

Обычный `search` не заполняет постоянную библиотеку. Материализация происходит при:

- `item save`;
- `favorite add`;
- `diary add`;
- включении item в рецепт.

## Формат продукта

Минимальный `product.json`:

```json
{
  "schema_version": 1,
  "kind": "food",
  "name": "Чечевичный хлеб",
  "aliases": ["мой хлеб"],
  "brand": null,
  "barcodes": [],
  "state": "as_sold",
  "basis": {
    "amount": 100,
    "unit": "g"
  },
  "nutrients": {
    "energy_kcal": 240,
    "protein_g": 18,
    "fat_g": 5,
    "carb_g": 31,
    "fiber_g": 9
  },
  "other_nutrients": {},
  "portions": [
    {
      "name": "кусок",
      "amount": 45,
      "unit": "g"
    }
  ],
  "category": "prepared_dish",
  "tags": []
}
```

Обязательны `schema_version`, `kind`, `name`, `basis` и `nutrients`. В `nutrients` обязательны
все пять ключей; `fiber_g` может быть `null`, если клетчатка неизвестна.

Допустимые состояния продукта:

```text
as_sold | dry | cooked | prepared | unknown
```

Допустимые единицы:

```text
g | ml | piece
```

В v1 нет преобразования `g ↔ ml` и пересчёта по плотности. Единица порции или ингредиента
должна совпадать с базовой единицей item. Неизвестные микроэлементы можно без потери хранить в
`other_nutrients`.

Готовое блюдо с уже известными КБЖУ следует создавать как `food`. `recipe` нужен, когда КБЖУ
должны рассчитываться из ингредиентов.

## Формат рецепта

`recipe.json`:

```json
{
  "schema_version": 1,
  "kind": "recipe",
  "name": "Чечевичный суп",
  "aliases": [],
  "ingredients": [
    {
      "item_id": "l::<uuid>",
      "amount": 200,
      "unit": "g"
    },
    {
      "item_id": "r::<uuid>",
      "amount": 100,
      "unit": "g"
    }
  ],
  "yield": {
    "amount": 1200,
    "unit": "g"
  },
  "portions": [
    {
      "name": "тарелка",
      "amount": 350,
      "unit": "g"
    }
  ],
  "tags": []
}
```

Ингредиентом может быть продукт или другой рецепт. При сохранении `kcal` проверяет:

- существование каждого item;
- пригодность внешнего или отсканированного item;
- совместимость единиц;
- положительные количества и выход блюда;
- отсутствие прямых и косвенных циклов.

Текущие КБЖУ рецепта рассчитываются из актуальных ингредиентов и выхода готового блюда.

## Сканирование изображений

```text
kcal scan <image> [--hint text] [--limit 10] [--allow-ai]
```

Поддерживаются PNG, JPEG, WEBP и GIF размером до 20 МиБ. Алгоритм:

1. ZXing локально ищет EAN-8, EAN-13, UPC-A, UPC-E и QR.
2. Единственный товарный код запускает обычный поиск по штрихкоду.
3. Если пригодного продукта нет, команда завершится ошибкой и предложит повторить запуск с
   `--allow-ai`. Только при наличии этого явного флага изображение, `--hint` и найденный QR payload
   отправляются в OpenRouter.
4. Ответ валидируется по строгой JSON Schema и сохраняется как `scan::<uuid>`.
5. Полный результат получает статус `active`; неполный или противоречивый — `needs_review`.

Несколько разных товарных штрихкодов считаются неоднозначностью и дают exit code `5`.

Для fallback через OpenRouter нужен только ключ:

```bash
export OPENROUTER_API_KEY="..."
```

По умолчанию используется `openrouter/auto` с low-cost routing. Конкретную модель можно
закрепить:

```bash
export KCAL_OPENROUTER_MODEL="provider/model"
```

Запрос включает structured output, `require_parameters: true`, `data_collection: deny` и
`zdr: true`. Несмотря на эти параметры, изображение при fallback покидает локальный компьютер и
обрабатывается внешним сервисом.

В SQLite не сохраняются байты изображения. Сохраняются SHA-256, исходный путь, модель,
структурированный результат и предупреждения.

Item со статусом `needs_review` нельзя добавить в дневник или рецепт. Исправьте недостающие
значения через `item update`, затем повторите операцию:

```bash
kcal item show scan::<uuid>
kcal item update scan::<uuid> --set name="Хлеб" --set basis.amount=100 --set basis.unit=g
kcal item show scan::<uuid>
```

## JSON-протокол и exit codes

Каждый успешный вызов печатает один JSON-документ в `stdout`. Ошибка печатает один
JSON-документ в `stderr`. Диагностический текст не смешивается с машинным выводом.

Пример успешного ответа:

```json
{
  "ok": true,
  "operation": "favorite.remove",
  "changed": true,
  "item_id": "off::8712345678905"
}
```

Пример неоднозначности:

```json
{
  "error": "ambiguous_match",
  "message": "could not choose one exact item for \"молоко\"",
  "candidates": [],
  "hint": "repeat the command with a candidate id"
}
```

| Код | Значение |
| ---: | --- |
| `0` | успех |
| `1` | runtime/API error |
| `2` | ошибка аргументов, данных или JSON Schema |
| `3` | требуется аутентификация |
| `4` | требуется явный `--yes` |
| `5` | неоднозначность или конфликт проверки |
| `6` | результат удалённой записи неизвестен |
| `7` | private API YAZIO изменился |

Разрушительные команды не задают интерактивных вопросов. Без `--yes` они завершаются кодом `4`
и возвращают точную команду для подтверждённого повтора в `retry_command`.

## Хранилище

Пути по умолчанию:

```text
База SQLite:  ${XDG_DATA_HOME:-~/.local/share}/kcal/kcal.sqlite3
Конфигурация: ${XDG_CONFIG_HOME:-~/.config}/kcal/
Состояние:    ${XDG_STATE_HOME:-~/.local/state}/kcal/
```

Миграции применяются автоматически при первой mutating-команде. Read-only команды работают и
без базы, возвращая пустой локальный результат и не создавая файл SQLite.

Основные данные включают каталог, алиасы, штрихкоды, нутриенты, порции, рецепты, Favorites,
дневник, ревизии, цели, результаты сканирования, внешний cache и ключи идемпотентности. Локальный
поиск использует SQLite FTS5.

## Конфигурация окружения

`.env.example` служит справочником. CLI сам не загружает `.env`; переменные нужно экспортировать
в shell или передать через менеджер окружения.

| Переменная | Назначение |
| --- | --- |
| `KCAL_DB_FILE` | полный путь к SQLite-файлу |
| `KCAL_DATA_DIR` | каталог локальных данных |
| `KCAL_CONFIG_DIR` | каталог конфигурации и токенов |
| `KCAL_STATE_DIR` | каталог состояния |
| `KCAL_TIMEOUT_MS` | timeout запросов к OFF/OpenRouter |
| `OPENROUTER_API_KEY` | API-ключ для распознавания этикеток |
| `KCAL_OPENROUTER_MODEL` | модель OpenRouter; по умолчанию `openrouter/auto` |
| `KCAL_OPENROUTER_API_URL` | базовый URL OpenRouter |
| `KCAL_OFF_API_URL` | базовый URL Open Food Facts |
| `KCAL_OFF_USER_AGENT` | User-Agent для Open Food Facts |
| `YAZIO_API_URL` | базовый URL private API YAZIO |
| `YAZIO_USER_AGENT` | версия клиента, принимаемая YAZIO |
| `YAZIO_ACCEPT_LANGUAGE` | язык и ранжирование поиска YAZIO |
| `YAZIO_COUNTRIES` | принудительный список стран поиска |
| `YAZIO_LOCALES` | принудительный список локалей |
| `YAZIO_TOKEN_FILE` | путь к сохранённым токенам |
| `YAZIO_TIMEOUT_MS` | timeout запросов к YAZIO |
| `YAZIO_RETRIES` | число безопасных повторов YAZIO-запросов |

Секреты не передаются через обычные CLI-флаги и не попадают в JSON или SQLite.

## Использование агентом

Рекомендуемый цикл:

1. Выполнить `kcal search <название>`.
2. Если выбор очевиден — использовать возвращённый item ID.
3. Если пользователь назвал точное сохранённое имя или алиас — можно сразу вызвать
   `kcal diary add <name> ...`.
4. При exit code `5` показать или проанализировать `candidates`, затем повторить вызов с ID.
5. Для каждого логического добавления генерировать стабильный `--op-key` и использовать его при
   сетевых или агентских повторах.
6. После записи использовать объект `day` из ответа или вызвать `kcal diary day`.

Не нужно отдельно определять, локальный item или внешний, и не нужно вызывать `item save` перед
`diary add`, `favorite add` или созданием рецепта.

## Ограничения v1

- один набор дневных целей без профилей пользователя и планов похудения;
- нет YAML, импорта/экспорта и синхронизации с удалённым дневником YAZIO;
- нет преобразования между массой, объёмом и штуками;
- нет встроенной усреднённой справочной базы продуктов;
- поиск Open Food Facts по названию является best-effort;
- качество внешних данных требует проверки пользователем;
- OpenRouter используется только как fallback распознавания этикетки, а не для обычного поиска.

## Разработка и тестирование

```bash
npm test
node --test test/local-diary.test.mjs
node --check bin/kcal.mjs
npm pack --dry-run
```

Стандартный `npm test` полностью сетенезависим: HTTP-вызовы замоканы. Live-проверки провайдеров намеренно не входят в стандартный набор и не должны запускаться в CI с личной учётной записью.

Изменения разрабатываются по циклу red → green → refactor: новое наблюдаемое поведение сначала
фиксируется падающим тестом, затем реализуется минимальное исправление и проводится рефакторинг
при зелёном наборе тестов.

## Лицензия

MIT
