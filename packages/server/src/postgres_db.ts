import {Pool} from 'pg';
import { Database } from "./models"
import format from 'pg-format'

export type DbRows = Record<string, unknown>[]

export class Postgres_Db implements Database {
  public pool: any
  constructor () {
    this.pool = new Pool({
        user: 'postgres',
        host: 'localhost',
        database: 'scalable_vega',
        password: 'postgres',
        port: 5432,
    }); 
  }

  private TypeFor(value: any): string {
	// FixMe: want to use INTs too, if possible.
	// Client needs to send more type data in this case.
	const type = typeof value;
	if (type === 'string') {
		return 'VARCHAR(256)';
	} else if (type === 'number') {
		return 'FLOAT';
	} else if (type === 'boolean') {
		return 'BOOLEAN';
	} else {
		throw 'undefined type: \'' + type + '\'';
	}
  }

  private listToSQLTuple(l: any[], keepQuotes: boolean): string {
    let out: string = JSON.stringify(l);
    out = out.substring(1, out.length - 1);
    out = out.replace(/'/g, '\'\'');
    out = out.replace(/"/g, keepQuotes ? '\'' : '');
    return out;
  }

  private SchemaFor(dataObj: any): any {
	const schema: any = {};
	for (var property in dataObj) {
		if (dataObj.hasOwnProperty(property)) {
			schema[property] = this.TypeFor(dataObj[property]);
		}
	}
	return schema;
  }

  private createTableQueryStrFor(tableName: string, schema: any): string {
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

  public async createTable(body: any): Promise<any> {

    var data = JSON.parse(body.data);
    // console.log(data)
	  var schema = this.SchemaFor(data[0]);
    var createTableQueryStr = this.createTableQueryStrFor(body.name, schema);
    return new Promise((resolve, reject) => {
      this.pool.query(createTableQueryStr, (err) => {
        console.log("create table")
        if (err) {
          reject(err)
        } else {
          resolve(this);
        }
      })
    })
  }

  public async importDatafile (name: any, filePath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      console.log("import csv file")
        this.pool.query(
          `CREATE TABLE ${name} AS SELECT * FROM read_csv_auto('${filePath}');`,
          (err) => {
            if (err) {
              reject(err)
            } else {
              resolve(this)
            }
          }
        )
    })
  }

  public async getRows (name: any): Promise<DbRows> {
    return new Promise((resolve, reject) => {
      this.pool.query(`SELECT * from ${name}`, (err, rows) => {
        if (err) {
          reject(err)
        } else {
          resolve(rows)
        }
      })
    })
  }


  public async runQuery(sql: string, params?: any): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      this.pool.query(sql, params, (err: Error, result: Record<string, unknown>[],) => {
        if (err) {
          reject(err)
        } else {
           resolve(result)
        }
      })
    })
  }

  public async InsertTable(body: any) {
    var data = JSON.parse(body.data);
	  var schema = this.SchemaFor(data[0]);
    let attrNames: string[] = [];
    console.log('Here1')
		for (const attrName in schema) {
			if (!schema.hasOwnProperty(attrName)) {
				continue;
			}
			attrNames.push(attrName);
		}
    console.log('Here2')
		const attrNamesStr = this.listToSQLTuple(attrNames, false);
    const rows: any[] = [];
		for (let i: number = 0; i < data.length; i++) {
			const item: any = data[i];
			const row: any[] = [];
			for (let j: number = 0; j < attrNames.length; j++) {
				row.push(item[attrNames[j]]);
			}
			rows.push(row);
		}
    console.log('Here3')
		// Execute the insert queries.
		var queryStr = format('insert into ' + body.name + ' (' + attrNamesStr + ') values %L', rows);
		console.log('running insert queries for ' + body.name);

    return new Promise((resolve, reject) => {
        this.pool.query(queryStr, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve(this);
          }
        })
      })

  }

}