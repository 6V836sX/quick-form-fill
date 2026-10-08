export const PROFILE_FIELDS = {
  fullName: ['姓名', 'name', 'full name', 'your name', 'display name'],
  givenName: ['名', 'first name', 'given name', 'given-name', 'firstname'],
  familyName: ['姓', 'last name', 'surname', 'family-name', 'lastname'],
  email: ['邮箱', '电子邮件', 'email', 'email address', 'e-mail'],
  phone: ['电话', '手机号', 'phone', 'phone number', 'mobile', 'tel'],
  username: ['用户名', 'username', 'user name', 'login name'],
  organization: ['公司', '单位', 'organization', 'company', 'company name'],
  jobTitle: ['职位', '职务', 'job title', 'organization-title'],
  address: ['地址', 'address', 'street address', 'street-address', 'address-line1'],
  city: ['城市', 'city', 'town', 'address-level2'],
  region: ['省份', 'state', 'province', 'address-level1'],
  postalCode: ['邮编', 'postal code', 'zip', 'zip code', 'postal-code'],
  country: ['国家', 'country', 'country-name'],
  website: ['网站', 'website', 'url', 'personal website'],
};
export const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s_\-:：*]+/g, '').trim();
export function exactMatches(fields, profile, definitions = PROFILE_FIELDS) {
  return fields.flatMap(field => {
    const candidates = Object.entries(definitions).filter(([key, aliases]) => profile[key] &&
      [field.autocomplete, field.label, field.name, field.placeholder].some(text => text && aliases.some(alias => normalize(text) === normalize(alias))));
    return candidates.length === 1 ? [{ id: field.id, key: candidates[0][0], source: '规则' }] : [];
  });
}
export function validateMappings(result, fields, profile, definitions = PROFILE_FIELDS) {
  if (!Array.isArray(result)) throw new Error('模型返回格式错误，请使用规则匹配或重试。');
  const counts = new Map();
  for (const item of result) if (item) counts.set(item.id, (counts.get(item.id) || 0) + 1);
  return result.filter(item => item && counts.get(item.id) === 1 && fields.some(field => field.id === item.id) &&
    Object.hasOwn(definitions, item.key) && typeof profile[item.key] === 'string' && profile[item.key].trim())
    .map(({ id, key }) => ({ id, key, source: 'GPT（请核对）' }));
}
