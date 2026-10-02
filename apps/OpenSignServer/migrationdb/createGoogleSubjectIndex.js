import { MongoClient } from 'mongodb';

export default async function createGoogleSubjectIndex() {
  const uri = process.env.DATABASE_URI || process.env.MONGODB_URI;
  if (!uri) return;
  const client = new MongoClient(uri);
  try {
    await client.connect();
    await client.db().collection('contracts_Users').createIndex(
      { GoogleSubject: 1 },
      {
        name: 'unique_workspace_google_subject',
        unique: true,
        partialFilterExpression: { GoogleSubject: { $type: 'string' } },
      }
    );
  } catch (error) {
    console.error('Could not create Workspace identity index:', error.message);
  } finally {
    await client.close();
  }
}
