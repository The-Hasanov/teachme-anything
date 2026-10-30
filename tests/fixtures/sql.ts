import type { Course, Segment } from '../../hooks/engine/types'

export const course: Course = {
  "format": "teachme.course/1",
  "id": "sql",
  "subject": "SQL queries",
  "goal": "pull the rows you need out of a database",
  "intake": [
    { "id": "know", "q": "How much SQL do you know?", "options": ["None", "I can read a SELECT", "I write simple queries"] },
    { "id": "from", "q": "What do you use most?", "options": ["Python", "Spreadsheets", "Another language"] },
    { "id": "why", "q": "What is SQL for?", "options": ["Work with an app's data", "Reports and analysis", "A course or an interview"] }
  ],
  "skills": [
    { "id": "select-where", "title": "Choose columns and filter rows", "type": "data", "prereqs": [], "misconceptions": [] },
    { "id": "order-by", "title": "Put rows in order", "type": "data", "prereqs": ["select-where"], "misconceptions": [
      { "tag": "order-default", "belief": "rows come back in a fixed order without ORDER BY" }
    ] },
    { "id": "null", "title": "Missing values (NULL)", "type": "data", "prereqs": ["select-where"], "misconceptions": [
      { "tag": "null-equals", "belief": "NULL compares like a value, so = NULL and <> 0 treat it as one", "prereq": "select-where" }
    ] }
  ],
  "phases": [
    { "id": "queries", "title": "Select, filter, sort", "skills": ["select-where", "order-by", "null"], "segments": ["sql-1"] }
  ],
  "setup": [
    { "id": "python", "title": "Python 3 (runs SQLite)", "adapter": "python", "where": "local", "why": "it includes SQLite, the database you will query" },
    { "id": "practice", "title": "Practice database in practice/sql-shop", "adapter": "practice", "where": "local" },
    { "id": "verify", "title": "Examples and exercises checked on your machine", "adapter": "verify", "where": "local" }
  ]
}

const SCHEMA = `CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT, category TEXT, price INTEGER, discount INTEGER);
INSERT INTO products VALUES
  (1, 'Mug', 'kitchen', 8, 0),
  (2, 'Lamp', 'home', 25, 5),
  (3, 'Kettle', 'kitchen', 30, NULL),
  (4, 'Candle', 'home', 6, NULL),
  (5, 'Desk', 'office', 120, 10),
  (6, 'Pen', 'office', 2, 0);
`

const RUN = `import sqlite3
import sys

# python run.py <file.sql>: runs the query in the file against shop.db and prints each row.
# --sorted prints the rows sorted, to compare rows whatever their order.
sql = open(sys.argv[1], encoding="utf-8").read()
if not "".join(l for l in sql.splitlines() if not l.strip().startswith("--")).strip():
    print("(no query yet)")
    sys.exit(1)
rows = [" | ".join("NULL" if v is None else str(v) for v in row) for row in sqlite3.connect("shop.db").execute(sql)]
for line in sorted(rows) if "--sorted" in sys.argv else rows:
    print(line)
`

const TABLE = "| name | price | discount |\n|---|---|---|\n| Mug | 8 | 0 |\n| Lamp | 25 | 5 |\n| Kettle | 30 | NULL |\n| Candle | 6 | NULL |\n| Desk | 120 | 10 |\n| Pen | 2 | 0 |"

const run = (file: string, out: string) => ({ "file": file, "argv": ["python", "run.py", file], "out": out })

export const sql1: Segment = {
  "format": "teachme.script/1",
  "id": "sql-1",
  "title": "Select, filter, sort",
  "skills": ["select-where", "order-by", "null"],
  "practice": {
    "adapter": "python",
    "dir": "practice/sql-shop",
    "scaffold": [
      ["@write", "schema.sql", SCHEMA],
      ["@write", "run.py", RUN],
      ["python", "-c", "import sqlite3; db = sqlite3.connect('shop.db'); db.executescript(open('schema.sql').read()); db.commit()"],
      ["@write", "cheap.sql", "-- Your query here\n"],
      ["@write", "no_discount.sql", "-- Your query here\n"]
    ]
  },
  "steps": [
    {
      "id": "q1", "kind": "compare", "skill": "select-where", "difficulty": 1,
      "title": "A query describes rows",
      "body": "`SELECT name FROM products WHERE price < 10;` asks for the name of every product under 10. SELECT picks columns, FROM names the table, WHERE keeps the rows that pass.",
      "compare": { "with": "Python", "text": "Like `[p.name for p in products if p.price < 10]`.", "stops": "Python runs your loop in the order you wrote it. SQL only says what you want: the database decides how, and without ORDER BY the order of rows is not promised." },
      "more": TABLE
    },
    {
      "id": "q2", "kind": "predict", "skill": "select-where", "difficulty": 1,
      "title": "Filter, then sort",
      "body": "Using the table below, what does this query return?\n\n" + TABLE,
      "code": { "lang": "sql", "source": "SELECT name FROM products\nWHERE price > 20\nORDER BY price DESC;", "run": run("q2.sql", "Desk\nKettle\nLamp") },
      "choices": [
        { "text": "Desk, Kettle, Lamp", "code": "Desk\nKettle\nLamp", "why": "Right: three products cost over 20, and DESC puts the highest price first." },
        { "text": "Lamp, Kettle, Desk", "code": "Lamp\nKettle\nDesk", "why": "Those are the right rows, lowest price first. DESC means highest first." },
        { "text": "Desk, Kettle, Lamp, Mug", "code": "Desk\nKettle\nLamp\nMug", "why": "Mug costs 8, so price > 20 leaves it out." },
        { "text": "Kettle, Lamp", "code": "Kettle\nLamp", "why": "Desk costs 120, which is over 20 too." }
      ],
      "key": [0]
    },
    {
      "id": "q3", "kind": "predict", "skill": "null", "difficulty": 2,
      "title": "Counting discounts",
      "body": "Two products have no discount set: it is NULL. What number does this return?\n\n" + TABLE,
      "code": { "lang": "sql", "source": "SELECT COUNT(*) FROM products\nWHERE discount <> 0;", "run": run("q3.sql", "2") },
      "choices": [
        { "text": "2", "why": "Right: Lamp and Desk. For Kettle and Candle, NULL <> 0 is not true, so WHERE drops them." },
        { "text": "4", "why": "That counts the NULL rows as \"not 0\". A comparison with NULL is never true." },
        { "text": "6", "why": "WHERE keeps only rows where the condition is true. Mug and Pen have 0." },
        { "text": "0", "why": "Lamp (5) and Desk (10) do have a discount other than 0." }
      ],
      "key": [0],
      "wrong": [
        { "match": { "choice": 1 }, "class": "misconception", "tag": "null-equals", "feedback": "NULL means \"unknown\". Is unknown different from 0? Unknown. WHERE keeps only rows where the answer is true.", "branch": "q3d" }
      ]
    },
    {
      "id": "q3d", "kind": "trace", "skill": "null", "difficulty": 1, "drill": true, "remedy": "null-equals",
      "title": "Row by row",
      "body": "WHERE works out the condition for each row and keeps the rows where it is true. SQLite shows true as 1 and false as 0. Fill in the last column for the first four rows.",
      "code": { "lang": "sql", "source": "SELECT discount <> 0 FROM products\nWHERE id <= 4;", "run": run("q3d.sql", "0\n1\nNULL\nNULL") },
      "trace": { "columns": ["name", "discount", "discount <> 0"], "rows": [["Mug", "0", "?"], ["Lamp", "5", "?"], ["Kettle", "NULL", "?"], ["Candle", "NULL", "?"]] },
      "choices": [
        { "text": "1", "why": "1 is true: the row would be kept." },
        { "text": "0", "why": "0 is false: 0 <> 0 is false." },
        { "text": "NULL", "why": "Any comparison with NULL gives NULL, unknown: not true, so WHERE drops the row." }
      ],
      "key": [1, 0, 2, 2]
    },
    {
      "id": "q3e", "kind": "mcq", "skill": "null", "difficulty": 1, "drill": true, "remedy": "null-equals",
      "title": "Find the missing ones",
      "body": "Which WHERE finds the products whose discount is not set?",
      "choices": [
        { "text": "WHERE discount IS NULL", "code": "WHERE discount IS NULL", "why": "Right: IS NULL is the test made for missing values." },
        { "text": "WHERE discount = NULL", "code": "WHERE discount = NULL", "why": "= NULL is never true, not even for NULL: it finds nothing." },
        { "text": "WHERE discount = 0", "code": "WHERE discount = 0", "why": "0 is a value: this finds Mug and Pen, not the missing ones." }
      ],
      "key": [0]
    },
    {
      "id": "q4", "kind": "reorder", "skill": "order-by", "difficulty": 1,
      "title": "Build a query",
      "body": "Press the lines in order: the kitchen products, cheapest first.",
      "choices": [
        { "text": "ORDER BY price;", "code": "ORDER BY price;", "why": "ORDER BY comes last: it sorts the rows that are left." },
        { "text": "FROM products", "code": "FROM products", "why": "FROM comes right after SELECT: it names the table." },
        { "text": "WHERE category = 'kitchen'", "code": "WHERE category = 'kitchen'", "why": "WHERE comes after FROM: it filters that table's rows." },
        { "text": "SELECT name, price", "code": "SELECT name, price", "why": "A query starts with SELECT and the columns you want." }
      ],
      "key": [3, 1, 2, 0]
    },
    {
      "id": "q5", "kind": "code", "open": "cheap.sql", "skill": "order-by", "difficulty": 2,
      "title": "Your turn: cheap things",
      "body": "In **cheap.sql**, write a query for the name and price of every product under 10, cheapest first.\n\nRun `python run.py cheap.sql` to see your rows, or press Check.",
      "check": {
        "probes": [
          { "id": "rows", "argv": ["python", "run.py", "cheap.sql", "--sorted"], "expect": { "equals": "Candle | 6\nMug | 8\nPen | 2" } },
          { "id": "order", "argv": ["python", "run.py", "cheap.sql"], "expect": { "equals": "Pen | 2\nCandle | 6\nMug | 8" } }
        ],
        "reference": [["@write", "cheap.sql", "SELECT name, price FROM products\nWHERE price < 10\nORDER BY price;\n"]]
      },
      "wrong": [
        { "match": { "probe": "order" }, "class": "misconception", "tag": "order-default", "feedback": "The rows are right, but their order is not promised. Say it: ORDER BY price puts the cheapest first." }
      ],
      "hints": ["You need two columns, one condition and one sort.", "WHERE price < 10 keeps the cheap ones.", "End with ORDER BY and the column to sort by."]
    },
    {
      "id": "q6", "kind": "code", "open": "no_discount.sql", "skill": "null", "difficulty": 3, "unseen": true,
      "title": "On your own: no discount set",
      "body": "In **no_discount.sql**, write a query for the names of the products whose discount is not set, in name order.\n\nThis one proves the skill: try it before asking.",
      "check": {
        "probes": [
          { "id": "rows", "argv": ["python", "run.py", "no_discount.sql"], "expect": { "equals": "Candle\nKettle" } }
        ],
        "reference": [["@write", "no_discount.sql", "SELECT name FROM products\nWHERE discount IS NULL\nORDER BY name;\n"]]
      },
      "wrong": [
        { "match": { "probe": "rows", "got": "^$" }, "class": "misconception", "tag": "null-equals", "feedback": "No rows came back. = NULL is never true, not even for NULL. Missing values need their own test." }
      ],
      "hints": ["A missing value is NULL, and = does not work with it.", "SQL has a special test for NULL.", "Sort by name at the end."]
    }
  ]
}

export const segments: Segment[] = [sql1]
