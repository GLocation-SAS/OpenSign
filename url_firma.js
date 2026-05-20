// ID_DOCUMENTO / CORREO / ID_FIRMANTE
const urlString = "EL7UUF0V1I/miguel.mendez@glocation.com.co/jd70GvakGz";
const base64Code = Buffer.from(urlString).toString('base64');
console.log(base64Code);
