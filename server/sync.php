<?php
/* server/sync.php — файловый backend синхронизации «Быстрого списка» без GitHub.
 *
 * Деплой на любой PHP-хостинг:
 *   1. Залить эту папку (sync.php + .htaccess) по HTTPS, например в
 *      https://твой-хостинг/папка/server/ — полный URL sync.php и нужен приложению.
 *   2. Задать секрет (общий ключ семьи): SetEnv QUICKLIST_SECRET <длинная-случайная-строка>
 *      в .htaccess или через переменные окружения в панели хостинга.
 *   3. Файл данных state.json создастся сам при первой отправке (лежит рядом).
 *      Бэкапь его иногда — это весь общий список.
 *
 * Протокол:
 *   GET  → 200 {rev, state} | 404 (ещё пусто)
 *   PUT {rev, state} → 200 {rev} | 409 (кто-то сохранился раньше — перечитай и повтори)
 * Авторизация: заголовок Authorization: Bearer <секрет>.
 */
header('Content-Type: application/json; charset=utf-8');
if (isset($_SERVER['HTTP_ORIGIN'])) {
  header('Access-Control-Allow-Origin: ' . $_SERVER['HTTP_ORIGIN']);
  header('Vary: Origin');
}
$method = isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : 'GET';
if ($method === 'OPTIONS') {
  header('Access-Control-Allow-Methods: GET, PUT, OPTIONS');
  header('Access-Control-Allow-Headers: Authorization, Content-Type');
  exit;
}

$secret = getenv('QUICKLIST_SECRET');
if (!$secret) {
  http_response_code(500);
  echo json_encode(array('error' => 'server misconfigured: no secret'));
  exit;
}
$auth = '';
if (isset($_SERVER['HTTP_AUTHORIZATION'])) $auth = $_SERVER['HTTP_AUTHORIZATION'];
elseif (isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) $auth = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
elseif (function_exists('apache_request_headers')) {
  $h = apache_request_headers();
  foreach ($h as $k => $v) {
    if (strtolower($k) === 'authorization') { $auth = $v; break; }
  }
}
if ($auth !== 'Bearer ' . $secret) {
  http_response_code(401);
  echo json_encode(array('error' => 'unauthorized'));
  exit;
}

$file = __DIR__ . '/state.json';

if ($method === 'GET') {
  if (!is_file($file)) {
    http_response_code(404);
    echo json_encode(array('error' => 'empty'));
    exit;
  }
  readfile($file);
  exit;
}

if ($method === 'PUT') {
  $in = json_decode(file_get_contents('php://input'), true);
  if (!is_array($in) || !isset($in['state']) || !is_array($in['state'])) {
    http_response_code(400);
    echo json_encode(array('error' => 'bad request'));
    exit;
  }
  $want = isset($in['rev']) ? $in['rev'] : null;
  $fp = fopen($file, 'c+');
  if (!$fp) {
    http_response_code(500);
    echo json_encode(array('error' => 'cannot store'));
    exit;
  }
  flock($fp, LOCK_EX);
  $raw = stream_get_contents($fp);
  $curRev = null;
  if ($raw !== '' && $raw !== false) {
    $cur = json_decode($raw, true);
    if (is_array($cur) && isset($cur['rev'])) $curRev = $cur['rev'];
  }
  if ($curRev !== null && $want !== $curRev) {
    flock($fp, LOCK_UN);
    fclose($fp);
    http_response_code(409);
    echo json_encode(array('error' => 'conflict'));
    exit;
  }
  $newRev = bin2hex(random_bytes(8));
  ftruncate($fp, 0);
  rewind($fp);
  fwrite($fp, json_encode(array('rev' => $newRev, 'state' => $in['state'])));
  fflush($fp);
  flock($fp, LOCK_UN);
  fclose($fp);
  echo json_encode(array('rev' => $newRev));
  exit;
}

http_response_code(405);
echo json_encode(array('error' => 'method not allowed'));
