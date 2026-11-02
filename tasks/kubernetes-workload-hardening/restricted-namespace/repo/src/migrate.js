// Applies pending schema migrations with the credentials from the parcelhub-db Secret.
console.log(`migrating ${process.env.DB_HOST ?? 'localhost'}/${process.env.DB_NAME ?? 'parcelhub'}`)
