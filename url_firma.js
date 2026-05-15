// ID_DOCUMENTO / CORREO / ID_FIRMANTE
const urlString = "CMlIic8RBl/miguel.mendez@glocation.com.co/jd70GvakGz";
const base64Code = Buffer.from(urlString).toString('base64');
console.log(base64Code);
