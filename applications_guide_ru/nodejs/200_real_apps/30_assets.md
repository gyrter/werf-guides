---
title: Генерируем и раздаём ассеты
permalink: nodejs/200_real_apps/30_assets.html
---

{% filesused title="Файлы, упомянутые в главе" %}
- .helm/templates/deployment.yaml
- .helm/templates/service.yaml
- .helm/templates/ingress.yaml
- .helm/templates/configmap.yaml
- .werf/nginx.conf
- src/config/env.json
- src/index.html
- src/index.js
- package.json
- package-lock.json
- webpack.config.js
- werf.yaml
{% endfilesused %}

В какой-то момент в процессе развития вашего базового приложения вам понадобятся ассеты (т.е. картинки, CSS, JS…).

Для того, чтобы обработать ассеты, воспользуемся webpack - это гибкий в плане реализации ассетов инструмент. Настраивается его поведение в `webpack.config.js` и `package.json`.

Реализовать сборку сгенерированных ассетов можно двумя способами:

![](/applications_guide_ru/images/applications-guide/assets-onedocker.png)

или

![](/applications_guide_ru/images/applications-guide/assets-twodockers.png)

{% offtopic title="Как правильно сделать выбор?" %}
В первом случае мы собираем один образ, но запускаем его двумя разными способами. Во втором мы делаем два отдельных образа. Чтобы сделать выбор, нужно учитывать:

- Как часто вносятся изменения в код, относящийся к каждому образу. Например, если изменения почти всегда вносятся одновременно и в статику, и в приложение — меньше смысла отделять их сборку: ведь всё равно оба пересобирать.
- Размер полученных образов и, как следствие, объём данных, которые придётся скачивать при каждом перевыкате.

Сравните два сценария:

- Над кодом работают fullstack-разработчики и они привыкли коммитить, когда всё уже готово. Следовательно, пересборка обычно затрагивает и frontend, и backend. Собранные по отдельности образы — 100 МБ и 600 МБ, а вместе - 620 МБ. Очевидно, стоит использовать один образ.
- Над кодом работают отдельно frontend и backend или же коммиты забрасываются и выкатываются часто (даже после мелких правок только в одной из частей кода). Собранные по отдельности образы сравнительно одинаковые: 100 МБ и 150 МБ, а вместе — 240 МБ. Если выкатывать вместе, то всегда будут пересобираться оба образа и выкатываться по 240 МБ, а если отдельно — то не более 150 МБ.
{% endofftopic %}

Мы сделаем два отдельных образа.

## Подготовка к внесению изменений

Перед тем, как вносить изменения, **необходимо убедиться, что в собранных ассетах нет привязки к конкретному окружению**. То есть в собранных образах не должно быть логинов, паролей, доменов и тому подобного. В момент сборки Node.js не должен подключаться к базе данных, использовать сгенерированный пользователями контент и т.д.

В традиции фронтэнд-разработки сложилась обратная практика: пробрасывать некоторые переменные, завязанные на окружение, на стадии сборки.

{% offtopic title="Так что делать с legacy-проектами?" %}
Мы понимаем, что существует огромное количество приложений, в которых конфигурация задаётся на стадии сборки. Однако решение проблемы legacy-проектов выходит за рамки этого самоучителя: мы рассматриваем задачу Kubernetes'ации на приложении, где такой проблемы нет.

Конечно, лучше начать переписывать legacy раньше, чем позже. Но мы понимаем, что это дорогая и сложная задача.

В качестве временной меры _иногда_ можно подставить вместо значения переменных, завязанных на окружение, уникальную строку. К примеру, если в приложение передаётся домен CDN-сервера `cdn_server` со значениями `mycdn0.mydomain.io` / `mycdn0-staging.mydomain.io` — можно вместо этих значений в сборку передать случайный GUID `cdfe0513-ba1f-4f92-8503-48a497d98059`. А в Helm-шаблонах, в init-контейнере, сделать с помощью утилиты [sed](https://ru.wikipedia.org/wiki/Sed) замену GUID'а на нужное именно на этом окружении значение.

Но использование этого или другого «костыля» является лишь временной мерой с сомнительным результатом и не избавляет от необходимости модернизировать JS-приложение.
{% endofftopic %}

## Код фронтэнда

С исходным кодом фронтэнд-приложения, которое мы будем использовать, можно [ознакомиться в репозитории](https://github.com/werf/werf-guides/tree/master/examples/nodejs/230_assets/). Оно будет состоять из **html файла**, который будет **подгружать JS-скрипты**. Те, в свою очередь, **при инициализации будут подгружать** переменные окружения из файла **`/config/env.json`** и, затем, **получать список лейблов из API**. 

{% offtopic title="Код приложения подробнее" %}

Код html-страницы:

{% snippetcut name="src/index.html" url="https://github.com/werf/werf-guides/blob/master/examples/nodejs/230_assets/src/index.html" %}
{% raw %}
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>My app</title>
</head>
<body>
<h1>Hello world!</h1>
<p>This is JS app.</p>
<p><strong>List of labels from backend: </strong><span id="content"></span></p>
<p><strong>Link from config: </strong> <a href="#" id="url">link</a></p>
</body>
</html>
```
{% endraw %}
{% endsnippetcut %}

JS, отображающий список лейблов и ссылку, зависящую от стенда, на который выкачено приложение:

{% snippetcut name="src/index.js" url="https://github.com/werf/werf-guides/blob/master/examples/nodejs/230_assets/src/index.js" %}
{% raw %}
```js
var request = new XMLHttpRequest();
request.open('GET', '/config/env.json', false);  // `false` makes the request synchronous
request.send(null);

if (request.status === 200) {
    const variables = JSON.parse(request.responseText);
    document.getElementById("url").href = variables.url;

    // Business logic here
    console.log('It works');
    var request_content = new XMLHttpRequest();
    request_content.open('GET', '/api/labels', false);  // `false` makes the request synchronous
    request_content.send(null);
    if (request_content.status === 200) {
        document.getElementById("content").innerHTML = request_content.responseText;
    } else {
        document.getElementById("content").innerHTML = "sorry, error while loading";
    }
}
```
{% endraw %}
{% endsnippetcut %}

Файл `env.json`, который при выкате на каждый стенд будет подменяться на актуальную для этого стенда версию (о том, как это будет происходить мы поговорим ниже):

{% snippetcut name="src/config/env.json" url="https://github.com/werf/werf-guides/blob/master/examples/nodejs/230_assets/src/config/env.json" %}
{% raw %}
```json
{
  "url": "http://defaultvalue.op"
}
```
{% endraw %}
{% endsnippetcut %}

Код сборки этого приложения Webpack-ом (обратите внимание, что файл `env.json` просто копируется и никак не применяется!):

{% snippetcut name="webpack.config.js" url="https://github.com/werf/werf-guides/blob/master/examples/nodejs/230_assets/webpack.config.js" %}
{% raw %}
```js
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const path = require("path");

module.exports = {
    plugins: [
        new HtmlWebpackPlugin({
            template: path.resolve(__dirname, "src", "index.html"),
        }),
        new CopyWebpackPlugin({
            patterns: [
                { from: "src/config", to: 'config' }
            ]
        }),
    ],
};
```
{% endraw %}
{% endsnippetcut %}

И добавим команду `build` и необходимые зависимости от webpack в `package.json`:

{% snippetcut name="package.json" url="https://github.com/werf/werf-guides/blob/master/examples/nodejs/230_assets/package.json" %}
{% raw %}
```json
{
  "name": "30-assets",
  "version": "1.0.0",
  "description": "Hello world app on NodeJs Express!",
  "main": "app.js",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1",
    "build": "rm -rf dist && webpack --config webpack.config.js --mode development"
  },
  "author": "Flant",
  "license": "ISC",
  "dependencies": {
    "express": "^4.17.1",
    "sqlite3": "^5.0.0"
  },
  "devDependencies": {
    "copy-webpack-plugin": "^6.0.3",
    "css-loader": "^4.2.0",
    "file-loader": "^6.0.0",
    "html-webpack-plugin": "^4.3.0",
    "sass": "^1.26.10",
    "sass-loader": "^9.0.3",
    "style-loader": "^1.2.1",
    "webpack": "^4.44.1",
    "webpack-cli": "^3.3.12",
    "webpack-dev-server": "^3.11.0"
  }
}
```
{% endraw %}
{% endsnippetcut %}

{% endofftopic %}

## Изменения в сборке

Для ассетов мы соберём отдельный образ с nginx и ассетами. Для этого воспользуемся [механизмом артефактов]({{ site.docsurl }}/documentation/configuration/stapel_artifact.html).

{% offtopic title="Что за артефакты?" %}
[Артефакт]({{ site.docsurl }}/documentation/configuration/stapel_artifact.html) — это специальный образ, используемый в других артефактах или отдельных образах, описанных в конфигурации. Артефакт предназначен преимущественно для отделения инструментов сборки и исходных кодов от финального скомпилированного результата. Так, в экосистеме NodeJS — это webpack, в Java — Maven, в C++ — make, в C# — MSBuild.

Важный и сложный вопрос — это отладка образов, в которых используются артефакты. Представим себе артефакт:

```yaml
artifact: my-simple-artifact
from: ubuntu:latest
...
```

Чтобы увидеть, что собирается внутри артефакта, и отладить процесс этой сборки, просто замените первый атрибут на `image` (и не забудьте отключить `mount` в том образе, куда монтируется артефакт):

```yaml
image: my-simple-artifact
from: ubuntu:latest
...
```

Теперь можно выполнять отладку `my-simple-artifact` с помощью [интроспекции стадий]({{ site.docsurl }}/documentation/reference/development_and_debug/stage_introspection.html).
{% endofftopic %}

Начнём с создания артефакта: установим необходимые пакеты и выполним сборку ассетов. Генерация ассетов должна происходить в артефакте на стадии `setup`:

{% snippetcut name="werf.yaml" url="https://github.com/werf/werf-guides/blob/master/examples/gitlab-nodejs/040-assets/werf.yaml" %}
{% raw %}
```yaml
---
artifact: assets-built
from: node:14-stretch
shell:
  beforeInstall:
  - apt update
  - apt install -y build-essential tzdata locales
  install:
  - cd /app && npm i
  setup:
  - cd /app && npm run build
git:
- add: /
  to: /app
  stageDependencies:
    install:
    - "package.json"
    - "package-lock.json"
    - "webpack*"
    setup:
    - "src/*"
```
{% endraw %}
{% endsnippetcut %}

Теперь, когда артефакт собран, соберём образ с nginx и импортируем туда сгенерированные ассеты:

{% snippetcut name="werf.yaml" url="https://github.com/werf/werf-guides/blob/master/examples/gitlab-nodejs/040-assets/werf.yaml" %}
{% raw %}
```yaml
---
image: node-assets
from: nginx:stable-alpine
docker:
  EXPOSE: '80'
shell:
  beforeInstall:
  - |
    head -c -1 <<'EOF' > /etc/nginx/nginx.conf
    {{ .Files.Get ".werf/nginx.conf" | nindent 4 }}
    EOF
import:
- artifact: assets-built
  add: /app/dist
  to: /www
  after: setup
```
{% endraw %}
{% endsnippetcut %}

_Исходный код `nginx.conf`` можно [посмотреть в репозитории](https://github.com/werf/werf-guides/tree/master/examples/gitlab-nodejs/040-assets/.werf/nginx.conf)._

{% offtopic title="Как в итоге выглядит werf.yaml?" %}
{% snippetcut name="werf.yaml" url="https://github.com/werf/werf-guides/blob/master/examples/gitlab-nodejs/040-assets/werf.yaml" %}
{% raw %}
```yaml
project: werf-guided-project
configVersion: 1
---
image: basicapp
from: node:14-stretch
git:
- add: /
  to: /app
  stageDependencies:
    install:
    - package.json
shell:
  beforeInstall:
  - apt update
  - apt install -y tzdata locales
  install:
  - cd /app && npm ci
docker:
  WORKDIR: /app
---
artifact: assets-built
from: node:14-stretch
shell:
  beforeInstall:
  - apt update
  - apt install -y build-essential tzdata locales
  install:
  - cd /app && npm i
  setup:
  - cd /app && npm run build
git:
- add: /
  to: /app
  stageDependencies:
    install:
    - "package.json"
    - "package-lock.json"
    - "webpack*"
    setup:
    - "src/*"
---
image: node-assets
from: nginx:stable-alpine
docker:
  EXPOSE: '80'
shell:
  beforeInstall:
  - |
    head -c -1 <<'EOF' > /etc/nginx/nginx.conf
    {{ .Files.Get ".werf/nginx.conf" | nindent 4 }}
    EOF
import:
- artifact: assets-built
  add: /app/dist
  to: /www
  after: setup
```
{% endraw %}
{% endsnippetcut %}
{% endofftopic %}

## Изменения в инфраструктуре и роутинге

Инфраструктуру мы можем организовать двумя способами:

![](/applications_guide_ru/images/applications-guide/assets-deploy-nodejs-1.png)

или

![](/applications_guide_ru/images/applications-guide/assets-deploy-nodejs-2.png)

В случае организации ассетов первый способ позволяет гибче управлять отдачей статики, с помощью `nginx.conf`, мы воспользуемся этим способом.

С помощью объекта Configmap мы будем пробрасывать в образ с nginx файл `/config/env.json` с актуальными именно для этого окружения данными.

{% snippetcut name=".helm/templates/deployment.yaml" url="https://github.com/werf/werf-guides/blob/master/examples/gitlab-nodejs/040-assets/.helm/templates/deployment.yaml" %}
{% raw %}
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: basicapp
spec:
  selector:
    matchLabels:
      app: basicapp
  revisionHistoryLimit: 3
  strategy:
    type: RollingUpdate
  replicas: 1
  template:
    metadata:
      annotations:
        checksum/config: {{ include (print $.Template.BasePath "/configmap.yaml") . | sha256sum }}
      labels:
        app: basicapp
    spec:
      imagePullSecrets:
      - name: "registrysecret"
      containers:
      - name: basicapp
        command: ["node","/app/app.js"]
        image: {{ tuple "basicapp" . | werf_image}}
        workingDir: /app
        ports:
        - containerPort: 3000
          protocol: TCP
        env:
        - name: "SQLITE_FILE"
          value: "app.db"
      - name: node-assets
        image: {{ tuple "node-assets" . | werf_image}}
        lifecycle:
          preStop:
            exec:
              command: ["/usr/sbin/nginx", "-s", "quit"]
        livenessProbe:
          httpGet:
            path: /healthz
            port: 80
            scheme: HTTP
        readinessProbe:
          httpGet:
            path: /healthz
            port: 80
            scheme: HTTP
        ports:
        - containerPort: 80
          name: http
          protocol: TCP
        volumeMounts:
        - name: env-json
          mountPath: /www/config/env.json
          subPath: env.json
      volumes:
      - name: env-json
        configMap:
          name: basicapp-configmap
```
{% endraw %}
{% endsnippetcut %}

В сам Configmap нужное значение мы будем пробрасывать через глобальный аттрибут:

{% snippetcut name=".helm/templates/configmap.yaml" url="https://github.com/werf/werf-guides/blob/master/examples/gitlab-nodejs/040-assets/.helm/templates/configmap.yaml" %}
{% raw %}
```yaml
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: basicapp-configmap
data:
  env.json: |
    {
      "url": {{ .Values.global.domain_url | quote }}
    }
```
{% endraw %}
{% endsnippetcut %}

А у сервиса укажем оба порта:

{% snippetcut name=".helm/templates/service.yaml" url="https://github.com/werf/werf-guides/blob/master/examples/gitlab-nodejs/040-assets/.helm/templates/service.yaml" %}
{% raw %}
```yaml
apiVersion: v1
kind: Service
metadata:
  name: basicapp
spec:
  selector:
    app: basicapp
  ports:
  - name: http
    port: 3000
    protocol: TCP
  - name: http-nginx
    port: 80
    protocol: TCP
```
{% endraw %}
{% endsnippetcut %}

## Деплой

Воспользуемся [командой `converge`](https://ru.werf.io/documentation/reference/cli/werf_converge.html) для сборки и деплоя, примерно так:

```bash
werf converge --repo localhost:5005/werf-guided-project --set="global.domain_url=http://myverycustomdomain.io"
```

<div id="go-forth-button">
    <go-forth url="201_build.html" label="Сборка образа" framework="{{ page.label_framework }}" ci="{{ page.label_ci }}" guide-code="{{ page.guide_code }}" base-url="{{ site.baseurl }}"></go-forth>
</div>