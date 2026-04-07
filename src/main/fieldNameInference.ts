/**
 * 根据字段名（中英文、snake / camel）推断「类型 + 生成规则」，供本地智能推荐使用。
 * 按顺序匹配，靠前的规则更具体；未命中返回 null，由调用方沿用原类型与默认规则。
 */

function splitTokens(fieldName: string): string[] {
  const n = fieldName.trim().toLowerCase()
  if (!n) return []
  const snake = n.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
  return snake.split(/_+/).filter(Boolean)
}

function hasCn(raw: string, ...subs: string[]): boolean {
  return subs.some((s) => raw.includes(s))
}

/** 当前公历年，用于 date(1900, 今年) 等 */
function currentYear(): number {
  return new Date().getFullYear()
}

export type InferredField = { field_type: string; rule_expr: string }

export function inferFieldTypeAndRuleFromName(fieldName: string): InferredField | null {
  const raw = fieldName.trim()
  if (!raw) return null
  const n = raw.toLowerCase()
  const tokens = splitTokens(fieldName)
  const y = currentYear()

  // —— 日期 / 时间（先匹配更具体的中文） ——
  if (hasCn(raw, '出生日期', '出生年月日')) {
    return { field_type: 'date', rule_expr: `date(1900,${y})` }
  }
  if (hasCn(raw, '生日', '诞辰')) {
    return { field_type: 'date', rule_expr: `date(1900,${y})` }
  }
  if (
    n === 'birthday' ||
    n === 'birth_date' ||
    n === 'birthdate' ||
    n === 'date_of_birth' ||
    n === 'dob' ||
    n === 'born_date' ||
    n.endsWith('_birthday') ||
    n.endsWith('_birth_date') ||
    n.endsWith('_date_of_birth')
  ) {
    return { field_type: 'date', rule_expr: `date(1900,${y})` }
  }
  if (tokens.includes('birthday') || (tokens.includes('birth') && tokens.includes('date'))) {
    return { field_type: 'date', rule_expr: `date(1900,${y})` }
  }

  if (
    hasCn(raw, '出生年', '出生年份') ||
    (tokens.includes('year') && tokens.includes('birth'))
  ) {
    return { field_type: 'int', rule_expr: `int(1900,${y})` }
  }

  if (
    hasCn(raw, '创建时间', '更新时间', '修改时间', '登记时间', '操作时间') ||
    n === 'created_at' ||
    n === 'updated_at' ||
    n === 'modified_at' ||
    n === 'create_time' ||
    n === 'update_time' ||
    n === 'last_modified' ||
    n.endsWith('_created_at') ||
    n.endsWith('_updated_at')
  ) {
    return { field_type: 'datetime', rule_expr: `datetime(2000,${y})` }
  }

  if (hasCn(raw, '日期') && !hasCn(raw, '时间')) {
    return { field_type: 'date', rule_expr: `date(2000,${y})` }
  }

  // —— 整数 ——
  if (hasCn(raw, '年龄')) {
    return { field_type: 'int', rule_expr: 'int(0,150)' }
  }
  if (tokens.includes('age')) {
    return { field_type: 'int', rule_expr: 'int(0,150)' }
  }
  if (
    hasCn(raw, '数量', '个数', '人数', '次数', '序号', '编号', '版本号') ||
    tokens.some((t) => ['qty', 'quantity', 'count', 'num', 'number', 'index', 'version'].includes(t))
  ) {
    return { field_type: 'int', rule_expr: 'int(0,99999)' }
  }
  if (hasCn(raw, '分数', '得分', '评分', '年级') || tokens.some((t) => ['score', 'grade'].includes(t))) {
    return { field_type: 'int', rule_expr: 'int(0,1000)' }
  }
  if (tokens.includes('year') || hasCn(raw, '年度', '年份')) {
    return { field_type: 'int', rule_expr: `int(2000,${y})` }
  }

  // —— 小数 / 金额 ——
  if (
    hasCn(raw, '金额', '价格', '单价', '总价', '工资', '薪资', '余额', '利率') ||
    tokens.some((t) =>
      ['amount', 'price', 'money', 'salary', 'fee', 'cost', 'balance', 'rate'].includes(t)
    )
  ) {
    return { field_type: 'decimal', rule_expr: 'decimal(0,1000000,2)' }
  }

  // —— 手机 / 邮箱 / 姓名 / 地址 ——
  if (hasCn(raw, '手机', '电话', '联系电话', '手机号', '座机') || tokens.some((t) => ['phone', 'mobile', 'tel'].includes(t))) {
    return { field_type: 'phone', rule_expr: 'phone' }
  }
  if (hasCn(raw, '邮箱', '电子邮件', '邮件') || tokens.some((t) => ['email', 'mail'].includes(t))) {
    return { field_type: 'email', rule_expr: 'email' }
  }
  if (
    hasCn(raw, '姓名', '名字', '联系人', '用户名') ||
    tokens.some((t) => ['name', 'username', 'nickname', 'realname', 'fullname'].includes(t))
  ) {
    if (tokens.includes('filename') || tokens.includes('pathname')) return null
    return { field_type: 'name', rule_expr: 'name' }
  }
  if (hasCn(raw, '地址', '住址', '收货地址') || tokens.some((t) => ['address', 'addr'].includes(t))) {
    return { field_type: 'address', rule_expr: 'address' }
  }

  // —— UUID / 自增 / 时间戳 ——
  if (tokens.includes('uuid') || n.endsWith('_uuid')) {
    return { field_type: 'uuid', rule_expr: 'uuid' }
  }
  if (!tokens.includes('uuid') && !raw.includes('UUID') && (n === 'id' || n.endsWith('_id'))) {
    return { field_type: 'increment', rule_expr: 'increment' }
  }

  if (tokens.includes('timestamp') || n.endsWith('_ts')) {
    return { field_type: 'timestamp', rule_expr: 'timestamp' }
  }

  // —— 布尔 / 状态枚举 ——
  if (
    hasCn(raw, '是否') ||
    n.startsWith('is_') ||
    n.startsWith('has_') ||
    tokens[0] === 'is' ||
    tokens[0] === 'has'
  ) {
    return { field_type: 'bool', rule_expr: 'enum(true,false)' }
  }
  if (
    hasCn(raw, '状态', '类型', '类别') ||
    tokens.some((t) => ['status', 'state', 'type', 'category'].includes(t))
  ) {
    return { field_type: 'enum', rule_expr: 'enum(OPTION_A,OPTION_B,OPTION_C)' }
  }

  // 性别枚举
  if (
    n === 'gender' ||
    n === 'sex' ||
    n === '性别'  
  ) {
    return { field_type: 'enum', rule_expr: 'enum(男,女)' }
  }

  return null
}
