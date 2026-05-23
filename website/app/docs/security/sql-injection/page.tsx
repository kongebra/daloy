import { CodeBlock } from "../../../../components/code-block";

import { buildMetadata } from "@/lib/seo";

export const metadata = buildMetadata({
  title: "SQL injection",
  description:
    "How Daloy's HTTP layer helps you stay safe from SQL injection, the ORM/driver patterns that close the rest of the gap, and the dynamic-SQL escape hatch (allowlists) for the cases that parameterized queries can't cover.",
  path: "/docs/security/sql-injection",
  keywords: [
    "DaloyJS SQL injection",
    "SQLi protection",
    "parameterized queries",
    "Prisma safe query",
    "Drizzle parameterized",
    "Kysely safe query",
    "in-app firewall",
  ],
  type: "article",
});

export default function Page() {
  return (
    <>
      <h1>SQL injection</h1>
      <p>
        SQL injection is the 7-on-the-original-OWASP-top-10,
        never-actually-died, still-causing-real-breaches class of bug.
        Aikido&apos;s{" "}
        <a
          href="https://www.aikido.dev/blog/the-state-of-sql-injections"
          target="_blank"
          rel="noreferrer"
        >
          State of SQL Injection
        </a>{" "}
        report shows it still accounts for ~7&ndash;10% of vulnerabilities found
        across open- and closed-source code. Daloy is an HTTP framework, not a
        database driver, so it can&apos;t parameterize your queries for you
        &mdash; but it does ship the layers <em>before</em> the database that
        make SQLi materially harder to introduce, and the patterns below close
        the rest.
      </p>

      <h2>What Daloy already does for you</h2>
      <p>
        These are core-enforced and require no opt-in. They don&apos;t replace
        parameterized queries, but they shrink the attack surface that reaches
        your repository layer in the first place.
      </p>
      <table>
        <thead>
          <tr>
            <th>Layer</th>
            <th>What it blocks</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Strict per-route schemas (Zod)</td>
            <td>
              Routes declare <code>params</code>, <code>query</code>, and{" "}
              <code>body</code> shapes. Inputs that don&apos;t match the schema
              are rejected with <strong>400 problem+json</strong> before your
              handler runs, so you almost never have to coerce raw strings into
              query parameters yourself.
            </td>
          </tr>
          <tr>
            <td>JSON parser hardening</td>
            <td>
              <code>safeJsonParse</code> strips <code>__proto__</code>,{" "}
              <code>constructor</code>, and <code>prototype</code> keys.
              Prevents prototype pollution that NoSQL/SQL adapters can turn into
              operator injection.
            </td>
          </tr>
          <tr>
            <td>Body-size cap</td>
            <td>
              1 MiB default, streamed. Removes the &ldquo;upload a 50&nbsp;MB
              payload of <code>OR 1=1</code>&rdquo; DoS-amplified-SQLi pattern.
            </td>
          </tr>
          <tr>
            <td>Structured logging redaction</td>
            <td>
              <code>redactRecord()</code> scrubs known credential-shaped fields
              before they hit logs &mdash; helpful when post-incident triage
              needs to share logs without re-leaking the very secrets the
              injection grabbed.
            </td>
          </tr>
          <tr>
            <td>Secure-by-default HTTP boundary</td>
            <td>
              CRLF header sanitization, path-traversal rejection in the router,
              and 405 instead of 404 on method confusion all mean attackers
              can&apos;t smuggle DB-bound payloads through quirky transport
              layers.
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        None of that <em>parameterizes your query</em>. That is on you and your
        ORM. The next sections show what &ldquo;safe&rdquo; looks like for the
        ORMs Daloy documents, and what the unsafe siblings look like so you can
        grep for them in code review.
      </p>

      <h2>The shape of a safe Daloy route</h2>
      <p>
        Validated input + parameterized query is the whole pattern.
        Aikido&apos;s report calls it out as defense #1 and #2; Daloy gives you
        both in one block.
      </p>
      <CodeBlock
        code={`import { App, z } from "@daloyjs/core";
import { db } from "./db";
import { users } from "./schema";
import { eq } from "drizzle-orm";

const app = new App();

app.route({
  method: "GET",
  path: "/users/:id",
  operationId: "getUser",
  // 1) The HTTP layer validates BEFORE the handler runs.
  params: z.object({ id: z.string().uuid() }),
  responses: { 200: { description: "ok" } },
  handler: async ({ params }) => {
    // 2) The ORM emits a parameterized query — params.id is bound, never spliced.
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, params.id))
      .limit(1);
    return { status: 200 as const, body: user ?? null };
  },
});`}
      />
      <p>
        Notice what is <em>not</em> here: no template string with{" "}
        <code>{"${params.id}"}</code>, no manual quoting, no &ldquo;just this
        once we&apos;ll trust the input.&rdquo; If you find yourself writing
        those in a Daloy handler, treat it as a bug.
      </p>

      <h2>Safe vs. unsafe per ORM</h2>

      <h3>Prisma</h3>
      <CodeBlock
        code={`// SAFE — Prisma always parameterizes \`where\` arguments.
await prisma.user.findUnique({ where: { id: params.id } });

// SAFE — \`$queryRaw\` is a tagged template; values become bind parameters.
await prisma.$queryRaw\`SELECT * FROM "User" WHERE id = \${params.id}\`;

// DANGEROUS — \`$queryRawUnsafe\` splices the string verbatim.
// Never pass user input to it. Use \`$queryRaw\` instead.
await prisma.$queryRawUnsafe(\`SELECT * FROM "User" WHERE id = '\${params.id}'\`);`}
      />

      <h3>Drizzle</h3>
      <CodeBlock
        code={`import { sql, eq } from "drizzle-orm";

// SAFE — builder API.
await db.select().from(users).where(eq(users.email, params.email));

// SAFE — \`sql\` tag binds values, doesn't splice them.
await db.execute(sql\`SELECT * FROM users WHERE email = \${params.email}\`);

// DANGEROUS — \`sql.raw\` inserts the string as-is.
// Only feed it constants or values you have allowlisted yourself.
await db.execute(sql.raw(\`SELECT * FROM users WHERE email = '\${params.email}'\`));`}
      />

      <h3>Kysely</h3>
      <CodeBlock
        code={`// SAFE — typed builder, parameterized at the driver level.
await db.selectFrom("users").where("email", "=", params.email).selectAll().execute();

// SAFE — \`sql\` template tag.
await sql\`SELECT * FROM users WHERE email = \${params.email}\`.execute(db);

// DANGEROUS — \`sql.raw\` / \`sql.lit\` skip binding.
await sql.raw(\`SELECT * FROM users WHERE email = '\${params.email}'\`).execute(db);`}
      />

      <h3>node-postgres / mysql2 (no ORM)</h3>
      <CodeBlock
        code={`// SAFE — placeholders are bound by the driver.
await pg.query("SELECT * FROM users WHERE email = $1", [params.email]);
await mysql.execute("SELECT * FROM users WHERE email = ?", [params.email]);

// DANGEROUS — template literal in the SQL string.
await pg.query(\`SELECT * FROM users WHERE email = '\${params.email}'\`);`}
      />

      <h2>Dynamic SQL: when you can&apos;t parameterize</h2>
      <p>
        Bind parameters cover values, not identifiers. <code>ORDER BY</code>{" "}
        columns, table names, direction (<code>ASC</code>/<code>DESC</code>),
        and dynamic <code>IN&nbsp;(...)</code> arities can&apos;t be bound, so
        the safe pattern is to <strong>allowlist</strong> the legal values
        instead of escaping. Daloy&apos;s recommended approach: encode the
        allowlist directly in your Zod schema so the HTTP boundary rejects
        anything else, then index into a typed map of identifiers in the
        handler.
      </p>
      <CodeBlock
        code={`import { z } from "@daloyjs/core";

// Map "API field name" -> "real column reference". The values are
// owned by your code, never derived from the request.
const SORT_COLUMNS = {
  createdAt: users.createdAt,
  email: users.email,
  name: users.name,
} as const;

const ListUsersQuery = z.object({
  sort: z.enum(["createdAt", "email", "name"]).default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

app.route({
  method: "GET",
  path: "/users",
  operationId: "listUsers",
  query: ListUsersQuery,
  responses: { 200: { description: "ok" } },
  handler: async ({ query }) => {
    const column = SORT_COLUMNS[query.sort];           // guaranteed safe
    const order = query.dir === "asc" ? asc(column) : desc(column);
    const rows = await db.select().from(users).orderBy(order).limit(query.limit);
    return { status: 200 as const, body: rows };
  },
});`}
      />
      <p>Rules of thumb when even allowlisting isn&apos;t enough:</p>
      <ul>
        <li>
          If you must accept a free-form identifier, validate it against a tight
          regex (<code>/^[a-zA-Z_][a-zA-Z0-9_]*$/</code>) <em>and</em> quote it
          with your driver&apos;s identifier-escape helper (
          <code>pg-format</code>&apos;s <code>%I</code>, Knex&apos;s{" "}
          <code>client.wrapIdentifier</code>, etc.). Never roll your own.
        </li>
        <li>
          For variable-arity <code>IN</code>, build the placeholder list from
          the array length and bind the values:{" "}
          <code>WHERE id IN ($1, $2, $3)</code>. Most ORMs do this for you when
          you pass an array to <code>inArray()</code> / <code>in</code>.
        </li>
        <li>
          For <code>LIKE</code> with user input, escape <code>%</code> and{" "}
          <code>_</code> in the value, then bind the escaped value. Don&apos;t
          splice the wildcards into the SQL string.
        </li>
      </ul>

      <h2>Things to grep for in code review</h2>
      <p>
        Aikido&apos;s report says vulnerable organizations average ~30 separate
        SQLi sites. The fastest way to keep that number at zero is a periodic
        grep across the repo. The Daloy maintainers use this list:
      </p>
      <CodeBlock
        language="bash"
        code={`# Tagged-template misuse and raw escape hatches.
git grep -nE '\\$queryRawUnsafe|\\$executeRawUnsafe' -- '*.ts' '*.tsx'
git grep -nE 'sql\\.raw\\(|sql\\.lit\\(' -- '*.ts' '*.tsx'

# String concatenation / interpolation into SQL.
git grep -nE '"\\s*(SELECT|INSERT|UPDATE|DELETE)[^"]*"\\s*\\+' -- '*.ts'
git grep -nE '\\\`[^\\\`]*(SELECT|INSERT|UPDATE|DELETE)[^\\\`]*\\$\\{' -- '*.ts'

# Knex / Sequelize raw bypasses.
git grep -nE '\\.raw\\(' -- '*.ts'`}
      />
      <p>
        Wire one of those into CI as a soft check (or as a Semgrep / CodeQL
        rule) and you&apos;ll catch ~all new SQLi at PR time. It&apos;s not as
        clever as a SAST tool, but it&apos;s free and runs in 200 ms.
      </p>

      <h2>Defense in depth: runtime firewalls</h2>
      <p>
        Daloy intentionally does <strong>not</strong> ship a heuristic
        SQLi-detector middleware. Pattern-matching <code>&apos; OR 1=1 --</code>{" "}
        on every request body is noisy, false- positives easily on legitimate
        text (think a blog post about SQL injection&hellip;), and gives a false
        sense of security. If you want a runtime backstop, install a proper
        in-app firewall that tokenizes queries against your real schema:
      </p>
      <ul>
        <li>
          <a href="https://www.aikido.dev/zen" target="_blank" rel="noreferrer">
            Aikido Zen
          </a>{" "}
          &mdash; Node/Bun-compatible in-app firewall that hooks the driver and
          blocks requests whose query structure was altered by user input.
        </li>
        <li>
          A reverse-proxy WAF (Cloudflare, AWS WAF, Fastly) for coarse signature
          matching at the edge. Cheap to deploy; not a substitute for
          parameterized queries.
        </li>
      </ul>

      <h2>Reporting</h2>
      <p>
        Found a SQLi-shaped weakness in Daloy itself (e.g. a sanitizer that
        leaks DB-meaningful characters, or a code example that demonstrates an
        unsafe pattern)? Report it privately via{" "}
        <a
          href="https://github.com/daloyjs/daloy/security/advisories/new"
          target="_blank"
          rel="noreferrer"
        >
          github.com/daloyjs/daloy/security/advisories/new
        </a>
        . Don&apos;t open a public issue.
      </p>
    </>
  );
}
