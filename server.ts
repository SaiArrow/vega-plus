import * as cors from 'cors';
import * as bodyParser from 'body-parser';
const { Pool } = require('pg');
const format = require('pg-format');

// load server configuration
import serverConfigRaw from './server.config.json';
const serverConfig = {
  "port": 3000,
  "dbms-config": "postgresql.config.json"
};
import dbmsConfigRaw from './postgresql.config.json';
const dbmsConfig = {
  "dbmsName":"postgresql",
  "dbname":"scalable_vega",
  "host":"localhost",
  "port":5432,
  "connectionString": "postgres://localhost:5432/scalable_vega"
};
console.log(dbmsConfig);

// Postgres connection pools.
const pools = {};

// Express server
const express = require('express');
const app = express();
const port = 3000;
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

app.listen(port, () => console.log(`server listening on port ${port}`));

function getConnectionName() {
  let name = dbmsConfig.dbmsName+":"+dbmsConfig.dbname;
  if ("port" in dbmsConfig) {
    name += ":"+dbmsConfig.port;
  }
  return name;
}

// TODO: fix to use connection info rather than raw string
function poolFor() {
  let connectionString: string = getConnectionName();
  // create or retrieve the connection pool for the given connection string
  if (!(connectionString in pools)) {
    let connInfo: any = {host: dbmsConfig.host, database: dbmsConfig.dbname};
    if ("port" in dbmsConfig) {
      connInfo.port = dbmsConfig.port;
    }
    pools[connectionString] = new Pool(connInfo);
  }
  return pools[connectionString];
}

function handleError(err: any, res: any) {
  // report observed errors and send them back to the client
  const msg = err.stack ? err.stack.split('\n')[0] : err;
  console.error(msg);
  res.status(400).send(msg);
}

// handle SQL query requests for vega dataflow
app.post('/query', async (req: any, res: any) => {
  let client: any;
  try {
    if (!req.body.query) {
      throw 'request body must define query property'
    }
    const query = req.body.query;
    console.log(`running query: ${query}`);
    const pool = poolFor();
    client = await pool.connect();
    console.log(`connected to ${getConnectionName()}`);
    const results = await client.query(query);
    res.status(200).send(results);
  } catch (err) {
    handleError(err, res);
  } finally {
    if (client) {
      client.release();
    }
  }
});

function postgresTypeFor(value: any): string {
  // map JavaScript data types to SQL data types
  // FixMe: want to use INTs too, if possible.
  // Client needs to send more type data in this case.
  const type = typeof value;
  if (type === 'string') {
    return 'VARCHAR(256)';
  } else if (type === 'number') {
    return 'DOUBLE';
  } else if (type === 'boolean') {
    return 'BOOLEAN';
  } else {
    throw 'undefined type: \'' + type + '\'';
  }
}

function postgresSchemaFor(dataObj: any): string {
  // create an object that maps property names to SQL data types (basically a
  // schema object)
  const schema: any = {};
  for (var property in dataObj) {
    if (dataObj.hasOwnProperty(property)) {
      schema[property] = postgresTypeFor(dataObj[property]);
    }
  }
  return schema;
}

function createTableQueryStrFor(tableName: string, schema: any): string {
  // given a table name and a schema object, make a corresponding "CREATE
  // TABLE" SQL query
  let out: string = 'create table ' + tableName + '('
  let first: boolean = true;
  for (var attrName in schema) {
    if (!schema.hasOwnProperty(attrName)) {
      continue;
    }
    let attrType: string = schema[attrName];
    if (first) {
      first = false;
    } else {
      out += ', ';
    }
    out += (attrName + ' ' + attrType)
  }
  out += ');';
  return out;
}

function listToSQLTuple(l: any[], keepQuotes: boolean): string {
  // takes a list of values and translates them to a string representing a
  // comma-separated list of the values
  let out: string = JSON.stringify(l);
  out = out.substring(1, out.length - 1);
  out = out.replace(/'/g, '\'\'');
  out = out.replace(/"/g, keepQuotes ? '\'' : '');
  return out;
}

// handle requests to create and populate a table in the DBMS
app.post('/createSql', async (req: any, res: any) => {
  let client: any;
  try {
    if (!req.body.data) {
      throw 'request body must define data property';
    }
    if (!req.body.name) {
      throw 'request body must define name property';
    }

    // Connect to postgres
    const pool = poolFor();
    client = await pool.connect();

    // Check if table exists yet
    let exists = false;
    const existsQueryStr = 'select exists(select 1 from information_schema.tables where table_name=' +
      '\'' + req.body.name.toLowerCase() + '\');'
    const response = await client.query(existsQueryStr);
    if (response.rows[0]['exists']) {
      exists = true;
      console.log('table ' + req.body.name + ' already exists');
    } else {
      exists = false;
      console.log('table ' + req.body.name + ' does not exist');
    }

    const data = JSON.parse(req.body.data);
    const schema: any = postgresSchemaFor(data[0]);

    // Create table if it doesn't exist yet
    if (!exists) {
      console.log('creating table ' + req.body.name);
      console.log('built postgres schema: ' + JSON.stringify(schema));
      const createTableQueryStr = createTableQueryStrFor(req.body.name, schema);
      console.log('running create query: ' + createTableQueryStr);
      await client.query(createTableQueryStr);
    }

    // Insert values

    // Build attribute list string e.g. (attr1, attr2, attr3)
    let attrNames: string[] = [];
    for (const attrName in schema) {
      if (!schema.hasOwnProperty(attrName)) {
        continue;
      }
      attrNames.push(attrName);
    }
    const attrNamesStr = listToSQLTuple(attrNames, false);

    // Transform data from JSON format into a 2d array where each row is a list of attribute values
    // with the same attribute order as the attribute list string above.
    const rows: any[] = [];
    for (let i: number = 0; i < data.length; i++) {
      const item: any = data[i];
      const row: any[] = [];
      for (let j: number = 0; j < attrNames.length; j++) {
        row.push(item[attrNames[j]]);
      }
      rows.push(row);
    }

    // Execute the insert queries.
    const queryStr = format('insert into ' + req.body.name + ' (' + attrNamesStr + ') values %L', rows);
    console.log('running insert queries for ' + req.body.name);
    await client.query(queryStr);
    console.log('insert queries complete')
    res.status(200).send();
  } catch (err) {
    handleError(err, res);
  } finally {
    if (client) {
      client.release();
    }
  }
});
