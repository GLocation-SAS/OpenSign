import createContactIndex from './createContactIndex.js';
import createDocumentIndex from './createDocumentIndex.js';
import createGoogleSubjectIndex from './createGoogleSubjectIndex.js';

export default async function runDbMigrations() {
  await createContactIndex();
  await createDocumentIndex();
  await createGoogleSubjectIndex();
}
