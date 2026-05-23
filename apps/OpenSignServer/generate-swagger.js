import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolver __dirname en ES Modules context
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Rutas absolutas a los archivos
const mainJsPath = path.join(__dirname, 'cloud/main.js');
const openapiJsonPath = path.join(__dirname, 'public/openapi.json');

console.log('====================================================');
console.log('       OpenSign Server Swagger/OpenAPI Generator    ');
console.log('====================================================\n');

function parseImportClause(clause) {
  const identifiers = [];
  clause = clause.trim();

  const wildcardMatch = clause.match(/\*\\s+as\s+(\w+)/);
  if (wildcardMatch) {
    identifiers.push(wildcardMatch[1]);
    return identifiers;
  }

  const bracesMatch = clause.match(/\{([^}]+)\}/);
  if (bracesMatch) {
    const named = bracesMatch[1].split(',');
    for (let name of named) {
      name = name.trim();
      if (!name) continue;
      if (name.includes(' as ')) {
        name = name.split(' as ')[1].trim();
      }
      identifiers.push(name);
    }
    clause = clause.replace(/\{[^}]+\}/, '');
  }

  clause = clause.replace(/,/g, '').trim();
  if (clause && !clause.includes('*')) {
    identifiers.push(clause);
  }

  return identifiers;
}

function inferType(paramName) {
  const name = paramName.toLowerCase();
  if (name.includes('is') || name.startsWith('allow') || name.startsWith('automatic') || name.includes('enabled')) {
    return 'boolean';
  }
  if (name.includes('count') || name.includes('days') || name.includes('limit') || name.includes('port') || name.includes('remind')) {
    return 'integer';
  }
  if (name.includes('documents') || name.includes('list') || name.includes('signers') || name.includes('bcc') || name.includes('pencolors')) {
    return 'array';
  }
  if (name.includes('userdetails') || name.includes('organization') || name.includes('team')) {
    return 'object';
  }
  return 'string';
}

function inferTypeSchema(paramName) {
  const type = inferType(paramName);
  if (type === 'array') {
    return {
      type: 'array',
      items: { type: 'string' },
      description: `List of ${paramName}`
    };
  } else if (type === 'object') {
    return {
      type: 'object',
      description: `Object representing ${paramName}`
    };
  } else if (type === 'boolean') {
    return {
      type: 'boolean',
      description: `Flag indicating ${paramName}`
    };
  } else if (type === 'integer') {
    return {
      type: 'integer',
      description: `Count/Number representing ${paramName}`
    };
  } else {
    return {
      type: 'string',
      description: `Value of ${paramName}`
    };
  }
}

function extractParams(fileContent) {
  const params = new Set();

  const destructureRegex = /(?:const|let|var)\s+\{\s*([^}]+)\s*\}\s*=\s*(?:request|req)(?:\??)\.params/g;
  let match;
  while ((match = destructureRegex.exec(fileContent)) !== null) {
    const rawFields = match[1];
    const fields = rawFields.split(',');
    for (let field of fields) {
      field = field.trim();
      if (!field) continue;
      if (field.includes(':')) {
        field = field.split(':')[0].trim();
      }
      if (field.includes('=')) {
        field = field.split('=')[0].trim();
      }
      if (/^[a-zA-Z0-9_$]+$/.test(field)) {
        params.add(field);
      }
    }
  }

  const directAccessRegex = /(?:request|req)(?:\??)\.params(?:\??)\.([a-zA-Z0-9_$]+)/g;
  while ((match = directAccessRegex.exec(fileContent)) !== null) {
    const field = match[1];
    params.add(field);
  }

  const paramsVarRegex = /(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:request|req)(?:\??)\.params/g;
  const paramsVars = [];
  while ((match = paramsVarRegex.exec(fileContent)) !== null) {
    paramsVars.push(match[1]);
  }

  for (const paramsVar of paramsVars) {
    const destructureParamsRegex = new RegExp(`(?:const|let|var)\\\\s+\\\\{\\\\s*([^}]+)\\\\s*\\\\}\\\\s*=\\\\s*${paramsVar}(?:\\\\??)`, 'g');
    while ((match = destructureParamsRegex.exec(fileContent)) !== null) {
      const rawFields = match[1];
      const fields = rawFields.split(',');
      for (let field of fields) {
        field = field.trim();
        if (!field) continue;
        if (field.includes(':')) {
          field = field.split(':')[0].trim();
        }
        if (field.includes('=')) {
          field = field.split('=')[0].trim();
        }
        if (/^[a-zA-Z0-9_$]+$/.test(field)) {
          params.add(field);
        }
      }
    }

    const directAccessParamsRegex = new RegExp(`\\\\b${paramsVar}(?:\\\\??)\\\\.([a-zA-Z0-9_$]+)`, 'g');
    while ((match = directAccessParamsRegex.exec(fileContent)) !== null) {
      const field = match[1];
      params.add(field);
    }
  }

  return Array.from(params);
}

try {
  if (!fs.existsSync(openapiJsonPath)) {
    throw new Error(`OpenAPI JSON file not found at: ${openapiJsonPath}`);
  }
  const openapiContent = fs.readFileSync(openapiJsonPath, 'utf8');
  const openapi = JSON.parse(openapiContent);

  if (!fs.existsSync(mainJsPath)) {
    throw new Error(`Parse cloud main file not found at: ${mainJsPath}`);
  }
  const mainJsContent = fs.readFileSync(mainJsPath, 'utf8');

  const importMap = new Map();
  const importRegex = /import\s+([\s\S]+?)\s+from\s+['"]([^'"]+)['"]/g;
  let importMatch;
  while ((importMatch = importRegex.exec(mainJsContent)) !== null) {
    const importClause = importMatch[1];
    const importPath = importMatch[2];
    const resolvedPath = path.resolve(path.dirname(mainJsPath), importPath);

    const identifiers = parseImportClause(importClause);
    for (const id of identifiers) {
      importMap.set(id, resolvedPath);
    }
  }

  console.log(`Mapped ${importMap.size} imported identifiers from cloud/main.js.\n`);

  const defineRegex = /Parse\.Cloud\.define\(\s*['"]([^'"]+)['"]\s*,\s*([a-zA-Z0-9_$]+)\s*\)/g;
  const cloudFunctions = [];
  let defineMatch;
  while ((defineMatch = defineRegex.exec(mainJsContent)) !== null) {
    const functionName = defineMatch[1];
    const identifier = defineMatch[2];
    const filePath = importMap.get(identifier);

    if (filePath) {
      cloudFunctions.push({ name: functionName, identifier, filePath });
    }
  }

  console.log(`Found ${cloudFunctions.length} Cloud Functions registered via Parse.Cloud.define.\n`);

  if (!openapi.tags) {
    openapi.tags = [];
  }
  const hasCloudTag = openapi.tags.some(tag => tag.name === 'Cloud Functions');
  if (!hasCloudTag) {
    openapi.tags.push({
      name: 'Cloud Functions',
      description: 'Dynamically parsed Parse Cloud Functions'
    });
  }

  if (!openapi.paths) {
    openapi.paths = {};
  }

  let updatedCount = 0;
  for (const { name, filePath } of cloudFunctions) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const fileContent = fs.readFileSync(filePath, 'utf8');
    const params = extractParams(fileContent);

    const properties = {};
    for (const param of params) {
      properties[param] = inferTypeSchema(param);
    }

    const pathKey = `/functions/${name}`;
    const relativeFilePath = path.relative(process.cwd(), filePath);

    const pathItem = {
      post: {
        tags: ['Cloud Functions'],
        summary: `Call Cloud Function: ${name}`,
        description: `Executes the Parse Cloud function '${name}' (defined in ${relativeFilePath}).`,
        operationId: `cloud_${name}`,
        parameters: [
          {
            name: 'X-Parse-Application-Id',
            in: 'header',
            required: true,
            schema: { type: 'string' },
            description: 'The Parse Application ID'
          },
          {
            name: 'X-Parse-Session-Token',
            in: 'header',
            required: false,
            schema: { type: 'string' },
            description: 'Session token for authenticated requests'
          }
        ],
        responses: {
          '200': {
            description: `Successfully executed '${name}'`,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    result: {
                      type: 'object',
                      description: 'The return value of the cloud function'
                    }
                  }
                }
              }
            }
          },
          '400': {
            description: 'Error executing cloud function'
          }
        }
      }
    };

    if (params.length > 0) {
      pathItem.post.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: properties
            }
          }
        }
      };
    }

    openapi.paths[pathKey] = pathItem;
    updatedCount++;
    console.log(`✅ Generated path: POST /functions/${name} | Params: [${params.join(', ') || 'none'}]`);
  }

  fs.writeFileSync(openapiJsonPath, JSON.stringify(openapi, null, 2), 'utf8');

  console.log('\n====================================================');
  console.log('🎉 SUCCESS: Dynamic Swagger/OpenAPI updated!');
  console.log(`Path: ${openapiJsonPath}`);
  console.log(`Processed endpoints: ${updatedCount}`);
  console.log('====================================================');

} catch (error) {
  console.error('❌ Error generating OpenAPI / Swagger specifications:', error.message);
  process.exit(1);
}
