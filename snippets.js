// Сниппеты для живой генерации. Весь код — Python, правдоподобный прод.
// Обе стороны сравнения используют одни и те же сниппеты в одном порядке.

// ---------- hint: префикс файла + короткое дополнение (1–4 строки) ----------
export const HINTS = [
  {
    file: "billing/invoices.py",
    prefix: `def total_with_tax(items: list[LineItem], rate: Decimal) -> Decimal:
    subtotal = Decimal("0")
    for item in items:
        `,
    completion: `subtotal += item.price * item.qty
    return (subtotal * (1 + rate)).quantize(Decimal("0.01"))`,
  },
  {
    file: "api/handlers.py",
    prefix: `@router.get("/users/{user_id}")
async def get_user(user_id: int, session: AsyncSession = Depends(get_session)):
    `,
    completion: `user = await session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="user not found")
    return UserOut.model_validate(user)`,
  },
  {
    file: "utils/retry.py",
    prefix: `def retry(times: int = 3, delay: float = 0.5):
    def decorator(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            for attempt in range(times):
                try:
                    return fn(*args, **kwargs)
                except Exception:
                    `,
    completion: `if attempt == times - 1:
                        raise
                    time.sleep(delay * 2 ** attempt)`,
  },
  {
    file: "data/loader.py",
    prefix: `def load_events(path: Path) -> pd.DataFrame:
    df = pd.read_parquet(path)
    `,
    completion: `df["ts"] = pd.to_datetime(df["ts"], utc=True)
    df = df.dropna(subset=["user_id"])
    return df.sort_values("ts").reset_index(drop=True)`,
  },
  {
    file: "services/cache.py",
    prefix: `class TTLCache:
    def __init__(self, ttl: float):
        self._ttl = ttl
        self._data: dict[str, tuple[float, Any]] = {}

    def get(self, key: str):
        `,
    completion: `item = self._data.get(key)
        if item is None or item[0] < time.monotonic():
            return None
        return item[1]`,
  },
  {
    file: "ml/metrics.py",
    prefix: `def precision_recall(y_true, y_pred):
    tp = sum(1 for t, p in zip(y_true, y_pred) if t and p)
    `,
    completion: `fp = sum(1 for t, p in zip(y_true, y_pred) if not t and p)
    fn = sum(1 for t, p in zip(y_true, y_pred) if t and not p)
    return tp / max(tp + fp, 1), tp / max(tp + fn, 1)`,
  },
  {
    file: "cli/main.py",
    prefix: `def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ingest")
    parser.add_argument("source", type=Path)
    `,
    completion: `parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--dry-run", action="store_true")
    return parser`,
  },
  {
    file: "db/queries.py",
    prefix: `async def active_orders(conn, customer_id: int, limit: int = 50):
    rows = await conn.fetch(
        `,
    completion: `"SELECT id, status, total FROM orders WHERE customer_id = $1 "
        "AND status = 'active' ORDER BY created_at DESC LIMIT $2",
        customer_id, limit,
    )
    return [dict(r) for r in rows]`,
  },
  {
    file: "config/settings.py",
    prefix: `class Settings(BaseSettings):
    database_url: str
    redis_url: str = "redis://localhost:6379/0"
    `,
    completion: `debug: bool = False
    request_timeout: float = 10.0

    model_config = SettingsConfigDict(env_file=".env")`,
  },
  {
    file: "tests/test_cart.py",
    prefix: `def test_cart_applies_discount(cart, promo):
    cart.add("sku-1", qty=2, price=Decimal("10.00"))
    `,
    completion: `cart.apply(promo)
    assert cart.total == Decimal("18.00")
    assert cart.discount == Decimal("2.00")`,
  },
  {
    file: "workers/queue.py",
    prefix: `async def consume(queue: asyncio.Queue, handler):
    while True:
        `,
    completion: `msg = await queue.get()
        try:
            await handler(msg)
        finally:
            queue.task_done()`,
  },
  {
    file: "auth/tokens.py",
    prefix: `def verify_token(token: str, secret: str) -> dict:
    try:
        `,
    completion: `return jwt.decode(token, secret, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise AuthError("token expired")`,
  },
  {
    file: "geo/distance.py",
    prefix: `def haversine(lat1, lon1, lat2, lon2):
    r = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    `,
    completion: `dphi = phi2 - phi1
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))`,
  },
  {
    file: "reports/export.py",
    prefix: `def to_csv(rows: Iterable[dict], path: Path) -> int:
    rows = list(rows)
    with path.open("w", newline="") as f:
        `,
    completion: `w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
    return len(rows)`,
  },
  {
    file: "pipeline/stages.py",
    prefix: `def chunked(seq: Sequence[T], size: int) -> Iterator[Sequence[T]]:
    `,
    completion: `for i in range(0, len(seq), size):
        yield seq[i : i + size]`,
  },
  {
    file: "http/client.py",
    prefix: `async def fetch_json(client: httpx.AsyncClient, url: str) -> dict:
    resp = await client.get(url, timeout=10.0)
    `,
    completion: `resp.raise_for_status()
    return resp.json()`,
  },
  {
    file: "search/rank.py",
    prefix: `def rerank(hits: list[Hit], boosts: dict[str, float]) -> list[Hit]:
    `,
    completion: `for h in hits:
        h.score *= boosts.get(h.source, 1.0)
    return sorted(hits, key=lambda h: h.score, reverse=True)`,
  },
  {
    file: "logging_setup.py",
    prefix: `def configure_logging(level: str = "INFO") -> None:
    `,
    completion: `logging.basicConfig(
        level=getattr(logging, level.upper()),
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )`,
  },
];

// ---------- chat: вопрос + 1–2 предложения + блок кода 10–20 строк ----------
export const CHATS = [
  {
    question: "Почему test_refund_idempotent иногда падает?",
    text: "Повторный вызов refund() не проверяет статус платежа, поэтому второй запрос создаёт ещё одну проводку. Нужен ключ идемпотентности и проверка до списания:",
    code: `def refund(payment_id: str, amount: Decimal, *, idem_key: str) -> Refund:
    with db.transaction() as tx:
        existing = tx.query(Refund).filter_by(idem_key=idem_key).one_or_none()
        if existing is not None:
            return existing

        payment = tx.query(Payment).with_for_update().get(payment_id)
        if payment.status != PaymentStatus.CAPTURED:
            raise RefundError(f"payment {payment_id} is {payment.status}")
        if amount > payment.refundable:
            raise RefundError("amount exceeds refundable balance")

        refund = Refund(payment_id=payment_id, amount=amount, idem_key=idem_key)
        payment.refundable -= amount
        tx.add(refund)
        return refund`,
  },
  {
    question: "Как добавить кэш к get_catalog(), не сломав инвалидацию?",
    text: "Самый простой вариант — кэш с версией каталога в ключе: при любом изменении версия растёт, и старые записи просто перестают читаться.",
    code: `CATALOG_VERSION_KEY = "catalog:version"

def get_catalog(shop_id: int) -> list[Product]:
    version = redis.get(CATALOG_VERSION_KEY) or b"0"
    key = f"catalog:{shop_id}:{version.decode()}"
    cached = redis.get(key)
    if cached is not None:
        return [Product(**p) for p in json.loads(cached)]

    products = repo.list_products(shop_id)
    redis.setex(key, 300, json.dumps([p.asdict() for p in products]))
    return products

def on_catalog_changed() -> None:
    # старые ключи устареют сами по TTL
    redis.incr(CATALOG_VERSION_KEY)`,
  },
  {
    question: "Что делает middleware в tracing.py?",
    text: "Оно оборачивает каждый запрос в span, прокидывает trace_id из заголовка (или создаёт новый) и дописывает его в логи, чтобы запросы можно было связать между сервисами.",
    code: `class TracingMiddleware:
    def __init__(self, app, tracer):
        self.app = app
        self.tracer = tracer

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        headers = dict(scope["headers"])
        trace_id = headers.get(b"x-trace-id", b"").decode() or new_trace_id()
        with self.tracer.start_span(scope["path"], trace_id=trace_id) as span:
            span.set_tag("http.method", scope["method"])
            token = trace_ctx.set(trace_id)
            try:
                await self.app(scope, receive, send)
            finally:
                trace_ctx.reset(token)`,
  },
  {
    question: "Как избавиться от N+1 в списке заказов?",
    text: "Сейчас для каждого заказа отдельно подгружаются позиции и клиент. Достаточно заранее загрузить связи одним запросом через joinedload и selectinload:",
    code: `def list_orders(session: Session, limit: int = 100) -> list[Order]:
    stmt = (
        select(Order)
        .options(
            joinedload(Order.customer),
            selectinload(Order.items).joinedload(OrderItem.product),
        )
        .order_by(Order.created_at.desc())
        .limit(limit)
    )
    return list(session.scalars(stmt).unique())

def serialize(orders: list[Order]) -> list[dict]:
    return [
        {
            "id": o.id,
            "customer": o.customer.name,
            "items": [{"sku": i.product.sku, "qty": i.qty} for i in o.items],
        }
        for o in orders
    ]`,
  },
  {
    question: "Почему сервис падает по таймауту под нагрузкой?",
    text: "Все запросы делят один синхронный клиент к внешнему API, поэтому медленный ответ блокирует поток. Вынесите вызов в пул с лимитом и таймаутом:",
    code: `_pool = ThreadPoolExecutor(max_workers=16)
_sem = asyncio.Semaphore(32)

async def call_pricing(sku: str) -> Price:
    async with _sem:
        loop = asyncio.get_running_loop()
        try:
            return await asyncio.wait_for(
                loop.run_in_executor(_pool, pricing_client.get, sku),
                timeout=2.0,
            )
        except asyncio.TimeoutError:
            metrics.incr("pricing.timeout")
            return Price.fallback(sku)`,
  },
  {
    question: "Как правильно закрывать соединения в воркере?",
    text: "Соединение нужно открывать в startup-хуке и закрывать в shutdown, а не создавать на каждое сообщение — иначе при пике закончится пул.",
    code: `class Worker:
    def __init__(self, dsn: str):
        self._dsn = dsn
        self._pool: asyncpg.Pool | None = None

    async def start(self) -> None:
        self._pool = await asyncpg.create_pool(self._dsn, min_size=2, max_size=10)

    async def stop(self) -> None:
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    async def handle(self, msg: Message) -> None:
        async with self._pool.acquire() as conn:
            await conn.execute("UPDATE jobs SET state = $1 WHERE id = $2", "done", msg.id)`,
  },
  {
    question: "Перепиши парсер конфига без eval",
    text: "Безопаснее разобрать значения явно: числа через int/float, булевы по списку допустимых строк, остальное оставить строкой.",
    code: `_TRUE = {"1", "true", "yes", "on"}
_FALSE = {"0", "false", "no", "off"}

def parse_value(raw: str):
    s = raw.strip()
    low = s.lower()
    if low in _TRUE:
        return True
    if low in _FALSE:
        return False
    for cast in (int, float):
        try:
            return cast(s)
        except ValueError:
            continue
    return s

def parse_config(text: str) -> dict:
    out = {}
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if "=" in line:
            key, value = line.split("=", 1)
            out[key.strip()] = parse_value(value)
    return out`,
  },
];

// ---------- agent: скрипты по 8–12 шагов (tool-вызовы, pytest, diff) ----------
// say — короткая реплика модели; call — вызов инструмента; out — вывод инструмента.
export const AGENTS = [
  {
    task: "Починить падающий test_parse_amount",
    steps: [
      {
        say: "Найду, где определён parse_amount.",
        call: 'grep -rn "def parse_amount" src/',
        out: "src/billing/parse.py:14:def parse_amount(raw: str) -> Decimal:",
      },
      {
        say: "Читаю реализацию.",
        call: "read_file src/billing/parse.py",
        out: `13
14  def parse_amount(raw: str) -> Decimal:
15      cleaned = raw.replace(" ", "").replace(",", ".")
16      return Decimal(cleaned)`,
      },
      {
        say: "Теперь тест.",
        call: "read_file tests/test_parse.py",
        out: `def test_parse_amount_thousands():
    assert parse_amount("1,234.50") == Decimal("1234.50")
    assert parse_amount("1 234,50") == Decimal("1234.50")`,
      },
      {
        say: "Запускаю тест, чтобы увидеть точную ошибку.",
        call: "run_tests tests/test_parse.py",
        out: `FAILED tests/test_parse.py::test_parse_amount_thousands
decimal.InvalidOperation: [<class 'decimal.ConversionSyntax'>]
1 failed in 0.21s`,
      },
      {
        say: "Запятая в «1,234.50» — разделитель тысяч, а не десятичная точка. Нужно различать форматы.",
        call: "apply_patch src/billing/parse.py",
        out: `@@ -14,3 +14,9 @@
 def parse_amount(raw: str) -> Decimal:
-    cleaned = raw.replace(" ", "").replace(",", ".")
+    cleaned = raw.replace(" ", "")
+    if "," in cleaned and "." in cleaned:
+        cleaned = cleaned.replace(",", "")
+    else:
+        cleaned = cleaned.replace(",", ".")
     return Decimal(cleaned)`,
      },
      {
        say: "Проверяю тест ещё раз.",
        call: "run_tests tests/test_parse.py",
        out: `FAILED tests/test_parse.py::test_parse_amount_negative
AssertionError: Decimal('-5.00') != Decimal('5.00')
1 failed, 1 passed in 0.19s`,
      },
      {
        say: "Знак теряется в обёртке. Смотрю currency.py.",
        call: "read_file src/billing/currency.py",
        out: `22  def normalize(value: Decimal) -> Decimal:
23      return abs(value).quantize(Decimal("0.01"))`,
      },
      {
        say: "abs() здесь лишний — убираю.",
        call: "apply_patch src/billing/currency.py",
        out: `@@ -22,2 +22,2 @@
 def normalize(value: Decimal) -> Decimal:
-    return abs(value).quantize(Decimal("0.01"))
+    return value.quantize(Decimal("0.01"))`,
      },
      {
        say: "Запускаю тесты модуля.",
        call: "run_tests tests/test_parse.py",
        out: "2 passed in 0.18s",
      },
      {
        say: "Прогоняю весь набор, чтобы убедиться, что ничего не сломал.",
        call: "run_tests",
        out: `128 passed in 9.42s`,
        green: true,
      },
    ],
  },
  {
    task: "Перевести даты на UTC во всём сервисе",
    steps: [
      {
        say: "Найду все вызовы datetime.now().",
        call: 'grep -rn "datetime.now()" src/',
        out: `src/jobs/report.py:31:    now = datetime.now()
src/api/orders.py:88:    created = datetime.now()
src/billing/invoices.py:57:    due = datetime.now() + timedelta(days=14)`,
      },
      {
        say: "Начну с отчётов.",
        call: "read_file src/jobs/report.py",
        out: `29  def build_report(day: date) -> Report:
30      start = datetime.combine(day, time.min)
31      now = datetime.now()`,
      },
      {
        say: "Заменяю на aware-время.",
        call: "apply_patch src/jobs/report.py",
        out: `-    start = datetime.combine(day, time.min)
-    now = datetime.now()
+    start = datetime.combine(day, time.min, tzinfo=UTC)
+    now = datetime.now(UTC)`,
      },
      {
        say: "Теперь API заказов.",
        call: "apply_patch src/api/orders.py",
        out: `-    created = datetime.now()
+    created = datetime.now(UTC)`,
      },
      {
        say: "И счета.",
        call: "apply_patch src/billing/invoices.py",
        out: `-    due = datetime.now() + timedelta(days=14)
+    due = datetime.now(UTC) + timedelta(days=14)`,
      },
      {
        say: "Запускаю тесты.",
        call: "run_tests",
        out: `FAILED tests/test_orders.py::test_created_is_naive
FAILED tests/test_report.py::test_day_boundaries
FAILED tests/test_invoices.py::test_due_date
3 failed, 119 passed in 9.71s`,
      },
      {
        say: "Тесты ожидают naive-время. Смотрю первый.",
        call: "read_file tests/test_orders.py",
        out: `41  def test_created_is_naive():
42      order = create_order(sku="x")
43      assert order.created.tzinfo is None`,
      },
      {
        say: "Тест фиксирует старое поведение — нужно обновить ожидание.",
        call: "apply_patch tests/test_orders.py",
        out: `-    assert order.created.tzinfo is None
+    assert order.created.tzinfo is UTC`,
      },
    ],
  },
];

// Текст «ответа модели» для плитки (агентный режим в сцене 1): реплика + вызов.
export function agentStepText(script, stepIndex) {
  const s = script.steps[stepIndex % script.steps.length];
  return `${s.say}\n$ ${s.call}\n${s.out}`;
}

// 3,5 символа ≈ 1 токен (для кода)
export const CHARS_PER_TOKEN = 3.5;
export const tokensOf = (text) => Math.max(1, Math.round(text.length / CHARS_PER_TOKEN));
