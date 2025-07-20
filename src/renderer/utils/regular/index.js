const Regular = (function () {
	const rules = {
		email(str) {
			return (/^([A-Za-z0-9_\-\.\u4e00-\u9fa5])+\@([A-Za-z0-9_\-\.])+\.([A-Za-z]{2,8})$/).test(str)
		},
		number(str) {
			return (/^[0-9]$/).test(str)
		},
		english(str) {
			return (/^[a-zA-Z]+$/).test(str)
		},
		text(str) {
			return (/^\w+$/).test(str)
		},
		chinese(str) {
			return (/^[\u4E00-\u9FA5]+$/).test(str)
		},
		lower(str) {
			return (/^[a-z]+$/).test(str)
		},
		upper(str) {
			return (/^[A-Z]+$/).test(str)
		},
		ip(str) {
			return (/^(\d{1,2}|1\d\d|2[0-4]\d|25[0-5])\.(\d{1,2}|1\d\d|2[0-4]\d|25[0-5])\.(\d{1,2}|1\d\d|2[0-4]\d|25[0-5])\.(\d{1,2}|1\d\d|2[0-4]\d|25[0-5])(:\d{5})?$/).test(str)
		}

	}
	return function (type, str) {
		if (type.constructor === Function) {
			rules[str] = type
		} else {
			return rules[type] ? rules[type](str) : false
		}
	}
}())

export default Regular
