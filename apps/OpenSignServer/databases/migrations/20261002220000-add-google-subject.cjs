exports.up = async Parse => {
  const schema = new Parse.Schema('contracts_Users');
  schema.addString('GoogleSubject');
  return schema.update();
};

exports.down = async Parse => {
  const schema = new Parse.Schema('contracts_Users');
  schema.deleteField('GoogleSubject');
  return schema.update();
};
