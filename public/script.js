// Хранение данных
let students = [];
let currentStudentId = null;
let currentUser = null;
let directorUsers = [];
let teachersWithStudents = [];

// Роли (совпадают с user_role в PostgreSQL)
const ROLES = {
    STUDENT: 'student',
    TEACHER: 'teacher',
    ACCOUNTANT: 'accountant',
    DIRECTOR: 'director'
};

// Права: студент — минимум; преподаватель и бухгалтер — ведение групп и оплат; директор — всё, включая удаление студентов
const PERMISSIONS = {
    [ROLES.STUDENT]: {
        viewAllStudents: false,
        addStudent: false,
        editStudent: false,
        deleteStudent: false,
        addPayment: false,
        deletePayment: false,
        viewReports: false,
        manageUsers: false
    },
    [ROLES.TEACHER]: {
        viewAllStudents: true,
        addStudent: true,
        editStudent: true,
        deleteStudent: false,
        addPayment: true,
        deletePayment: true,
        viewReports: true,
        manageUsers: false
    },
    [ROLES.ACCOUNTANT]: {
        viewAllStudents: true,
        addStudent: true,
        editStudent: true,
        deleteStudent: false,
        addPayment: true,
        deletePayment: true,
        viewReports: true,
        manageUsers: false
    },
    [ROLES.DIRECTOR]: {
        viewAllStudents: true,
        addStudent: true,
        editStudent: true,
        deleteStudent: true,
        addPayment: true,
        deletePayment: true,
        viewReports: true,
        manageUsers: true
    }
};

const AUTH_TOKEN_KEY = 'authToken';
const AUTH_USER_KEY = 'authUser';

function switchAuthTab(mode) {
    const isLogin = mode === 'login';
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const authTitle = document.getElementById('authTitle');
    const loginTab = document.getElementById('authTabLogin');
    const registerTab = document.getElementById('authTabRegister');
    if (!loginForm || !registerForm) return;

    loginForm.style.display = isLogin ? 'block' : 'none';
    registerForm.style.display = isLogin ? 'none' : 'block';
    if (authTitle) authTitle.textContent = isLogin ? '🔐 Вход' : '📝 Регистрация';
    if (loginTab && registerTab) {
        loginTab.classList.toggle('active', isLogin);
        registerTab.classList.toggle('active', !isLogin);
    }
}

async function apiFetch(path, options = {}) {
    const isPublicAuth = path === '/api/auth/login' || path === '/api/auth/register';
    const token = isPublicAuth ? null : localStorage.getItem(AUTH_TOKEN_KEY);
    const headers = { ...(options.headers || {}) };
    if (options.body && typeof options.body === 'string' && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    const res = await fetch(path, { ...options, headers });
    if (res.status === 401 && !isPublicAuth) {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
        currentUser = null;
        students = [];
        showLoginModal();
        throw new Error('Сессия истекла');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `Ошибка ${res.status}`);
    }
    return data;
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuth();

    const paymentDateInput = document.getElementById('paymentDate');
    if (paymentDateInput) {
        paymentDateInput.valueAsDate = new Date();
    }
});

// Проверка авторизации
async function checkAuth() {
    const token = localStorage.getItem(AUTH_TOKEN_KEY);
    if (!token) {
        showLoginModal();
        return;
    }
    try {
        const { user } = await apiFetch('/api/auth/me');
        currentUser = user;
        showMainContent();
        await loadStudents();
        renderStudents();
        updateStatistics();
    } catch {
        showLoginModal();
    }
}

// Показ модального окна авторизации
function showLoginModal() {
    document.getElementById('loginModal').classList.add('show');
    document.getElementById('mainContainer').style.display = 'none';
    switchAuthTab('login');
}

// Показ основного контента
function showMainContent() {
    document.getElementById('loginModal').classList.remove('show');
    document.getElementById('mainContainer').style.display = 'block';
    
    const roleNames = {
        [ROLES.STUDENT]: 'Студент',
        [ROLES.TEACHER]: 'Преподаватель',
        [ROLES.ACCOUNTANT]: 'Бухгалтер',
        [ROLES.DIRECTOR]: 'Директор'
    };

    document.getElementById('currentUserRole').textContent =
        roleNames[currentUser.role] || currentUser.role;
    updateUIByRole();
}

function syncPaymentFormVisibility() {
    const block = document.getElementById('paymentAddBlock');
    if (!block) return;
    if (!currentUser || !PERMISSIONS[currentUser.role]) {
        block.style.display = 'none';
        return;
    }
    block.style.display = PERMISSIONS[currentUser.role].addPayment ? 'block' : 'none';
}

// Обновление UI в зависимости от роли
function updateUIByRole() {
    if (!currentUser || !PERMISSIONS[currentUser.role]) return;
    const perms = PERMISSIONS[currentUser.role];

    const addStudentBtn = document.getElementById('addStudentBtn');
    if (addStudentBtn) {
        addStudentBtn.style.display = perms.addStudent ? 'inline-block' : 'none';
    }

    const reportsBtn = document.getElementById('reportsBtn');
    if (reportsBtn) {
        reportsBtn.style.display = perms.viewReports ? 'inline-block' : 'none';
    }

    const accessBtn = document.getElementById('accessBtn');
    if (accessBtn) {
        accessBtn.style.display = perms.manageUsers ? 'inline-block' : 'none';
    }

    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.style.display = perms.viewAllStudents ? '' : 'none';
    }

    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    if (sidebar && mainContent) {
        if (perms.viewAllStudents) {
            sidebar.style.display = '';
            mainContent.classList.remove('main-content-student-only');
        } else {
            sidebar.style.display = 'none';
            mainContent.classList.add('main-content-student-only');
        }
    }

    const mainTitle = document.getElementById('mainTitle');
    if (mainTitle) {
        mainTitle.textContent = perms.viewAllStudents
            ? '🎓 Учёт оплаты обучения студентами'
            : '🎓 Мои оплаты за обучение';
    }

    syncPaymentFormVisibility();
}

// Авторизация
async function login(event) {
    event.preventDefault();

    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;

    if (!username || !password) {
        alert('Укажите логин и пароль');
        return;
    }

    try {
        const data = await apiFetch('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password }),
        });
        localStorage.setItem(AUTH_TOKEN_KEY, data.token);
        localStorage.setItem(AUTH_USER_KEY, JSON.stringify(data.user));
        currentUser = data.user;
        showMainContent();
        await loadStudents();
        renderStudents();
        updateStatistics();
    } catch (e) {
        alert(e.message || 'Ошибка входа');
    }
}

async function registerUser(event) {
    event.preventDefault();
    const fullName = document.getElementById('registerFullName').value.trim();
    const email = document.getElementById('registerEmail').value.trim();
    const password = document.getElementById('registerPassword').value;
    const confirmPassword = document.getElementById('registerPasswordConfirm').value;

    if (password !== confirmPassword) {
        alert('Пароли не совпадают');
        return;
    }

    try {
        const data = await apiFetch('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ fullName, email, password, confirmPassword }),
        });
        alert(data.message || 'Регистрация успешна');
        document.getElementById('registerForm').reset();
        switchAuthTab('login');
    } catch (e) {
        alert(e.message || 'Ошибка регистрации');
    }
}

// Выход
function logout() {
    if (confirm('Вы уверены, что хотите выйти?')) {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        localStorage.removeItem(AUTH_USER_KEY);
        currentUser = null;
        students = [];
        showLoginModal();
    }
}

async function loadStudents() {
    students = await apiFetch('/api/students');
    students = students.map((student) => {
        if (!student.specialty) student.specialty = '';
        if (!student.course) student.course = 1;
        if (!student.enrollmentOrder) student.enrollmentOrder = '';
        if (!student.nextPaymentDate) student.nextPaymentDate = '';
        if (!student.payments) student.payments = [];
        student.totalCost = parseFloat(student.totalCost);
        student.payments = student.payments.map((p) => ({
            ...p,
            amount: parseFloat(p.amount),
        }));
        return student;
    });
}

// Конвертация файла в base64
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// Открытие модального окна добавления студента
function openAddStudentModal() {
    if (!PERMISSIONS[currentUser.role]?.addStudent) {
        alert('У вас нет прав для добавления студентов');
        return;
    }
    
    currentStudentId = null;
    document.getElementById('modalTitle').textContent = 'Добавить студента';
    document.getElementById('studentForm').reset();
    document.getElementById('studentModal').classList.add('show');
}

// Закрытие модального окна студента
function closeStudentModal() {
    document.getElementById('studentModal').classList.remove('show');
    currentStudentId = null;
}

// Сохранение студента
async function saveStudent(event) {
    event.preventDefault();

    const payload = {
        name: document.getElementById('studentName').value.trim(),
        specialty: document.getElementById('studentSpecialty').value.trim(),
        course: parseInt(document.getElementById('studentCourse').value, 10),
        group: document.getElementById('studentGroup').value.trim(),
        enrollmentOrder: document.getElementById('enrollmentOrder').value.trim(),
        phone: document.getElementById('studentPhone').value.trim(),
        email: document.getElementById('studentEmail').value.trim(),
        totalCost: parseFloat(document.getElementById('totalCost').value),
        nextPaymentDate: document.getElementById('nextPaymentDate').value || '',
    };

    try {
        if (currentStudentId) {
            if (!PERMISSIONS[currentUser.role]?.editStudent) {
                alert('У вас нет прав для редактирования студентов');
                return;
            }
            await apiFetch(`/api/students/${currentStudentId}`, {
                method: 'PUT',
                body: JSON.stringify(payload),
            });
        } else {
            if (!PERMISSIONS[currentUser.role]?.addStudent) {
                alert('У вас нет прав для добавления студентов');
                return;
            }
            await apiFetch('/api/students', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
        }

        await loadStudents();
        renderStudents();
        updateStatistics();
        closeStudentModal();
    } catch (e) {
        alert(e.message || 'Ошибка сохранения');
    }
}

// Удаление студента
async function deleteStudent(id) {
    if (!PERMISSIONS[currentUser.role]?.deleteStudent) {
        alert('У вас нет прав для удаления студентов');
        return;
    }

    if (!confirm('Вы уверены, что хотите удалить этого студента?')) {
        return;
    }

    try {
        await apiFetch(`/api/students/${id}`, { method: 'DELETE' });
        await loadStudents();
        renderStudents();
        updateStatistics();
    } catch (e) {
        alert(e.message || 'Ошибка удаления');
    }
}

// Открытие модального окна платежей
function openPaymentModal(id) {
    currentStudentId = id;
    const student = students.find(s => s.id === id);
    
    if (!student) return;
    
    document.getElementById('paymentStudentName').textContent = student.name;
    document.getElementById('paymentTotalCost').textContent = student.totalCost.toLocaleString('ru-RU');
    
    const paid = calculatePaidAmount(student);
    const remaining = student.totalCost - paid;
    
    document.getElementById('paymentPaid').textContent = paid.toLocaleString('ru-RU');
    document.getElementById('paymentRemaining').textContent = remaining.toLocaleString('ru-RU');
    
    document.getElementById('paymentForm').reset();
    document.getElementById('paymentDate').valueAsDate = new Date();
    
    renderPaymentsList(student);
    syncPaymentFormVisibility();
    document.getElementById('paymentModal').classList.add('show');
}

// Закрытие модального окна платежей
function closePaymentModal() {
    document.getElementById('paymentModal').classList.remove('show');
    currentStudentId = null;
}

// Добавление платежа
async function addPayment(event) {
    event.preventDefault();
    
    if (!PERMISSIONS[currentUser.role]?.addPayment) {
        alert('У вас нет прав для добавления платежей');
        return;
    }
    
    const student = students.find(s => s.id === currentStudentId);
    if (!student) return;
    
    const checkFileInput = document.getElementById('paymentCheckFile');
    let checkFileBase64 = null;
    
    if (checkFileInput.files.length > 0) {
        try {
            checkFileBase64 = await fileToBase64(checkFileInput.files[0]);
        } catch (error) {
            alert('Ошибка при загрузке файла чека');
            return;
        }
    }
    
    const sid = currentStudentId;
    const semesterVal = document.getElementById('paymentSemester').value;

    try {
        await apiFetch(`/api/students/${sid}/payments`, {
            method: 'POST',
            body: JSON.stringify({
                amount: parseFloat(document.getElementById('paymentAmount').value),
                date: document.getElementById('paymentDate').value,
                semester: semesterVal || null,
                checkNumber: document.getElementById('paymentCheckNumber').value.trim(),
                checkFile: checkFileBase64,
                note: document.getElementById('paymentNote').value.trim(),
            }),
        });
        await loadStudents();
        renderStudents();
        updateStatistics();
        openPaymentModal(sid);
    } catch (e) {
        alert(e.message || 'Ошибка добавления платежа');
    }
}

// Удаление платежа
async function deletePayment(studentId, paymentId) {
    if (!PERMISSIONS[currentUser.role]?.deletePayment) {
        alert('У вас нет прав для удаления платежей');
        return;
    }

    const student = students.find(s => s.id === studentId);
    if (!student || !student.payments) return;

    if (!confirm('Вы уверены, что хотите удалить этот платеж?')) {
        return;
    }

    try {
        await apiFetch(`/api/payments/${paymentId}`, { method: 'DELETE' });
        await loadStudents();
        renderStudents();
        updateStatistics();
        openPaymentModal(studentId);
    } catch (e) {
        alert(e.message || 'Ошибка удаления платежа');
    }
}

// Вычисление суммы оплаченных платежей
function calculatePaidAmount(student) {
    if (!student.payments || student.payments.length === 0) {
        return 0;
    }
    return student.payments.reduce((sum, payment) => sum + payment.amount, 0);
}

// Получение статуса оплаты
function getPaymentStatus(student) {
    const paid = calculatePaidAmount(student);
    const total = student.totalCost;
    
    if (paid >= total) {
        return { status: 'paid', text: 'Оплачено полностью', class: 'status-paid' };
    } else if (paid > 0) {
        return { status: 'partial', text: 'Частичная оплата', class: 'status-partial' };
    } else {
        return { status: 'unpaid', text: 'Не оплачено', class: 'status-unpaid' };
    }
}

// Получение напоминания о следующем платеже
function getNextPaymentReminder(student) {
    if (!student.nextPaymentDate) return null;
    
    const nextDate = new Date(student.nextPaymentDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    nextDate.setHours(0, 0, 0, 0);
    
    const diffTime = nextDate - today;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
        return { text: `Просрочено на ${Math.abs(diffDays)} дн.`, class: 'reminder-overdue' };
    } else if (diffDays === 0) {
        return { text: 'Платеж сегодня!', class: 'reminder-today' };
    } else if (diffDays <= 7) {
        return { text: `Через ${diffDays} дн.`, class: 'reminder-soon' };
    } else {
        return { text: `Через ${diffDays} дн.`, class: 'reminder-normal' };
    }
}

// Рендеринг списка студентов
function renderStudents() {
    if (!currentUser) return;
    const container = document.getElementById('studentsList');
    if (!container) return;
    
    const searchTerm = document.getElementById('searchInput')?.value.toLowerCase() || '';
    
    let filteredStudents = students;
    if (searchTerm) {
        filteredStudents = students.filter(student => 
            student.name.toLowerCase().includes(searchTerm) ||
            (student.specialty && student.specialty.toLowerCase().includes(searchTerm)) ||
            student.group.toLowerCase().includes(searchTerm) ||
            (student.phone && student.phone.includes(searchTerm)) ||
            (student.email && student.email.toLowerCase().includes(searchTerm))
        );
    }
    
    if (filteredStudents.length === 0) {
        const studentNoLink =
            currentUser &&
            currentUser.role === ROLES.STUDENT &&
            !searchTerm &&
            students.length === 0;
        container.innerHTML = `
            <div class="empty-state">
                <h3>${
                    studentNoLink
                        ? 'Карточка не привязана'
                        : searchTerm
                          ? 'Студенты не найдены'
                          : 'Нет студентов'
                }</h3>
                <p>${
                    studentNoLink
                        ? 'Обратитесь к директору или бухгалтерии, чтобы привязать ваш логин к записи студента в системе.'
                        : searchTerm
                          ? 'Попробуйте изменить поисковый запрос'
                          : 'Добавьте первого студента, нажав кнопку выше'
                }</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = filteredStudents.map(student => {
        const paid = calculatePaidAmount(student);
        const remaining = student.totalCost - paid;
        const percentage = student.totalCost > 0 ? (paid / student.totalCost * 100) : 0;
        const status = getPaymentStatus(student);
        const reminder = getNextPaymentReminder(student);
        
        let progressClass = '';
        if (percentage >= 100) {
            progressClass = '';
        } else if (percentage >= 50) {
            progressClass = 'warning';
        } else {
            progressClass = 'danger';
        }
        
        return `
            <div class="student-card">
                <div class="student-header">
                    <div class="student-info">
                        <h3>${escapeHtml(student.name)}</h3>
                        ${student.specialty ? `<p>🎓 ${escapeHtml(student.specialty)}</p>` : ''}
                        ${student.course ? `<p>📖 Курс: ${student.course}</p>` : ''}
                        <p>📚 Группа: ${escapeHtml(student.group)}</p>
                        ${student.enrollmentOrder ? `<p>📄 Приказ: ${escapeHtml(student.enrollmentOrder)}</p>` : ''}
                        ${student.phone ? `<p>📞 ${escapeHtml(student.phone)}</p>` : ''}
                        ${student.email ? `<p>✉️ ${escapeHtml(student.email)}</p>` : ''}
                        ${reminder ? `<p class="${reminder.class}">⏰ Следующий платеж: ${reminder.text}</p>` : ''}
                    </div>
                    <div class="student-actions">
                        <button class="btn btn-info btn-sm" onclick="openStudentCard('${student.id}')">
                            📋 Карточка
                        </button>
                        <button class="btn btn-success btn-sm" onclick="openPaymentModal('${student.id}')">
                            💳 Платежи
                        </button>
                        ${PERMISSIONS[currentUser.role]?.editStudent ? `
                        <button class="btn btn-primary btn-sm" onclick="editStudent('${student.id}')">
                            ✏️ Редактировать
                        </button>
                        ` : ''}
                        ${PERMISSIONS[currentUser.role]?.deleteStudent ? `
                        <button class="btn btn-danger btn-sm" onclick="deleteStudent('${student.id}')">
                            🗑️ Удалить
                        </button>
                        ` : ''}
                    </div>
                </div>
                <div class="student-progress">
                    <div class="progress-info">
                        <span>Оплачено: <strong>${paid.toLocaleString('ru-RU')} ₽</strong> из <strong>${student.totalCost.toLocaleString('ru-RU')} ₽</strong></span>
                        <span><strong>${percentage.toFixed(1)}%</strong></span>
                    </div>
                    <div class="progress-bar">
                        <div class="progress-fill ${progressClass}" style="width: ${Math.min(percentage, 100)}%">
                            ${percentage >= 10 ? `${percentage.toFixed(0)}%` : ''}
                        </div>
                    </div>
                    <div class="status-badge ${status.class}">${status.text}</div>
                    ${remaining > 0 ? `<p style="margin-top: 10px; color: #dc3545; font-weight: 600;">Остаток к оплате: ${remaining.toLocaleString('ru-RU')} ₽</p>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// Открытие карточки студента
function openStudentCard(id) {
    const student = students.find(s => s.id === id);
    if (!student) return;
    
    const paid = calculatePaidAmount(student);
    const remaining = student.totalCost - paid;
    const reminder = getNextPaymentReminder(student);
    
    const content = `
        <div class="student-card-detail">
            <div class="card-section">
                <h3>Данные студента</h3>
                <p><strong>ФИО:</strong> ${escapeHtml(student.name)}</p>
                ${student.specialty ? `<p><strong>Специальность:</strong> ${escapeHtml(student.specialty)}</p>` : ''}
                ${student.course ? `<p><strong>Курс:</strong> ${student.course}</p>` : ''}
                <p><strong>Группа:</strong> ${escapeHtml(student.group)}</p>
                ${student.enrollmentOrder ? `<p><strong>Приказ зачисления:</strong> ${escapeHtml(student.enrollmentOrder)}</p>` : ''}
                ${student.phone ? `<p><strong>Телефон:</strong> ${escapeHtml(student.phone)}</p>` : ''}
                ${student.email ? `<p><strong>Email:</strong> ${escapeHtml(student.email)}</p>` : ''}
            </div>
            
            <div class="card-section">
                <h3>Финансовая информация</h3>
                <p><strong>Стоимость обучения:</strong> ${student.totalCost.toLocaleString('ru-RU')} ₽</p>
                <p><strong>Оплачено:</strong> ${paid.toLocaleString('ru-RU')} ₽</p>
                <p><strong>Остаток:</strong> ${remaining.toLocaleString('ru-RU')} ₽</p>
                ${reminder ? `<p class="${reminder.class}"><strong>Следующий платеж:</strong> ${reminder.text} (${new Date(student.nextPaymentDate).toLocaleDateString('ru-RU')})</p>` : ''}
            </div>
            
            <div class="card-section">
                <h3>История платежей</h3>
                ${renderPaymentsListForCard(student)}
            </div>
        </div>
    `;
    
    document.getElementById('studentCardContent').innerHTML = content;
    document.getElementById('studentCardTitle').textContent = `Карточка студента: ${student.name}`;
    currentStudentId = id;
    document.getElementById('studentCardModal').classList.add('show');
}

// Закрытие карточки студента
function closeStudentCardModal() {
    document.getElementById('studentCardModal').classList.remove('show');
    currentStudentId = null;
}

// Рендеринг списка платежей для карточки
function renderPaymentsListForCard(student) {
    if (!student.payments || student.payments.length === 0) {
        return '<p>Нет платежей</p>';
    }
    
    return student.payments.map(payment => {
        const date = new Date(payment.date);
        const formattedDate = date.toLocaleDateString('ru-RU', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        let semesterText = '';
        if (payment.semester === 'first') semesterText = '1 семестр';
        else if (payment.semester === 'second') semesterText = '2 семестр';
        else if (payment.semester === 'full') semesterText = 'Весь период обучения';
        
        let checkHtml = '';
        if (payment.checkFile) {
            checkHtml = `
                <div style="margin-top: 10px;">
                    <strong>Чек:</strong>
                    <img src="${payment.checkFile}" alt="Чек" style="max-width: 300px; margin-top: 5px; border: 1px solid #ddd; border-radius: 5px;">
                </div>
            `;
        }
        
        return `
            <div class="payment-item-card">
                <div class="payment-item-info">
                    <div class="payment-item-amount">${payment.amount.toLocaleString('ru-RU')} ₽</div>
                    <div class="payment-item-date">📅 ${formattedDate}</div>
                    ${semesterText ? `<div>За что оплачено: ${semesterText}</div>` : ''}
                    ${payment.checkNumber ? `<div>Номер чека: ${escapeHtml(payment.checkNumber)}</div>` : ''}
                    ${payment.note ? `<div class="payment-item-note">${escapeHtml(payment.note)}</div>` : ''}
                    ${checkHtml}
                </div>
            </div>
        `;
    }).join('');
}

// Печать карточки студента
function printStudentCard() {
    const student = students.find(s => s.id === currentStudentId);
    if (!student) return;
    
    const printWindow = window.open('', '_blank');
    const paid = calculatePaidAmount(student);
    const remaining = student.totalCost - paid;
    const reminder = getNextPaymentReminder(student);
    
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Карточка студента - ${escapeHtml(student.name)}</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; }
                h1 { color: #333; }
                .section { margin-bottom: 20px; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                table td, table th { border: 1px solid #ddd; padding: 8px; }
                table th { background-color: #f2f2f2; }
            </style>
        </head>
        <body>
            <h1>Карточка студента</h1>
            <div class="section">
                <h2>Данные студента</h2>
                <table>
                    <tr><th>Поле</th><th>Значение</th></tr>
                    <tr><td>ФИО</td><td>${escapeHtml(student.name)}</td></tr>
                    ${student.specialty ? `<tr><td>Специальность</td><td>${escapeHtml(student.specialty)}</td></tr>` : ''}
                    ${student.course ? `<tr><td>Курс</td><td>${student.course}</td></tr>` : ''}
                    <tr><td>Группа</td><td>${escapeHtml(student.group)}</td></tr>
                    ${student.enrollmentOrder ? `<tr><td>Приказ зачисления</td><td>${escapeHtml(student.enrollmentOrder)}</td></tr>` : ''}
                    ${student.phone ? `<tr><td>Телефон</td><td>${escapeHtml(student.phone)}</td></tr>` : ''}
                    ${student.email ? `<tr><td>Email</td><td>${escapeHtml(student.email)}</td></tr>` : ''}
                </table>
            </div>
            <div class="section">
                <h2>Финансовая информация</h2>
                <table>
                    <tr><th>Показатель</th><th>Значение</th></tr>
                    <tr><td>Стоимость обучения</td><td>${student.totalCost.toLocaleString('ru-RU')} ₽</td></tr>
                    <tr><td>Оплачено</td><td>${paid.toLocaleString('ru-RU')} ₽</td></tr>
                    <tr><td>Остаток</td><td>${remaining.toLocaleString('ru-RU')} ₽</td></tr>
                    ${reminder ? `<tr><td>Следующий платеж</td><td>${reminder.text} (${new Date(student.nextPaymentDate).toLocaleDateString('ru-RU')})</td></tr>` : ''}
                </table>
            </div>
            <div class="section">
                <h2>История платежей</h2>
                <table>
                    <tr><th>Дата</th><th>Сумма</th><th>За что оплачено</th><th>Номер чека</th><th>Примечание</th></tr>
                    ${student.payments && student.payments.length > 0 ? student.payments.map(p => {
                        const date = new Date(p.date);
                        let semesterText = '';
                        if (p.semester === 'first') semesterText = '1 семестр';
                        else if (p.semester === 'second') semesterText = '2 семестр';
                        else if (p.semester === 'full') semesterText = 'Весь период обучения';
                        return `<tr>
                            <td>${date.toLocaleDateString('ru-RU')}</td>
                            <td>${p.amount.toLocaleString('ru-RU')} ₽</td>
                            <td>${semesterText || '-'}</td>
                            <td>${p.checkNumber || '-'}</td>
                            <td>${p.note || '-'}</td>
                        </tr>`;
                    }).join('') : '<tr><td colspan="5">Нет платежей</td></tr>'}
                </table>
            </div>
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.print();
}

// Редактирование студента
function editStudent(id) {
    if (!PERMISSIONS[currentUser.role]?.editStudent) {
        alert('У вас нет прав для редактирования студентов');
        return;
    }
    
    const student = students.find(s => s.id === id);
    if (!student) return;
    
    currentStudentId = id;
    document.getElementById('modalTitle').textContent = 'Редактировать студента';
    document.getElementById('studentName').value = student.name;
    document.getElementById('studentSpecialty').value = student.specialty || '';
    document.getElementById('studentCourse').value = student.course || 1;
    document.getElementById('studentGroup').value = student.group;
    document.getElementById('enrollmentOrder').value = student.enrollmentOrder || '';
    document.getElementById('studentPhone').value = student.phone || '';
    document.getElementById('studentEmail').value = student.email || '';
    document.getElementById('totalCost').value = student.totalCost;
    document.getElementById('nextPaymentDate').value = student.nextPaymentDate || '';
    document.getElementById('studentModal').classList.add('show');
}

// Рендеринг списка платежей
function renderPaymentsList(student) {
    const container = document.getElementById('paymentsList');
    if (!container) return;
    
    if (!student.payments || student.payments.length === 0) {
        container.innerHTML = '<p class="empty-state">Нет платежей</p>';
        return;
    }
    
    container.innerHTML = student.payments.map(payment => {
        const date = new Date(payment.date);
        const formattedDate = date.toLocaleDateString('ru-RU', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });

        let semesterText = '';
        if (payment.semester === 'first') semesterText = '1 семестр';
        else if (payment.semester === 'second') semesterText = '2 семестр';
        else if (payment.semester === 'full') semesterText = 'Весь период обучения';
        
        let checkHtml = '';
        if (payment.checkFile) {
            checkHtml = `
                <div style="margin-top: 10px;">
                    <strong>Чек:</strong><br>
                    <img src="${payment.checkFile}" alt="Чек" style="max-width: 200px; margin-top: 5px; border: 1px solid #ddd; border-radius: 5px; cursor: pointer;" onclick="window.open('${payment.checkFile}', '_blank')">
                </div>
            `;
        }
        
        return `
            <div class="payment-item">
                <div class="payment-item-info">
                    <div class="payment-item-amount">${payment.amount.toLocaleString('ru-RU')} ₽</div>
                    <div class="payment-item-date">📅 ${formattedDate}</div>
                    ${semesterText ? `<div>За что оплачено: ${semesterText}</div>` : ''}
                    ${payment.checkNumber ? `<div>Номер чека: ${escapeHtml(payment.checkNumber)}</div>` : ''}
                    ${payment.note ? `<div class="payment-item-note">${escapeHtml(payment.note)}</div>` : ''}
                    ${checkHtml}
                </div>
                ${PERMISSIONS[currentUser.role]?.deletePayment ? `
                <button class="btn btn-danger btn-sm" onclick="deletePayment('${student.id}', '${payment.id}')">
                    🗑️
                </button>
                ` : ''}
            </div>
        `;
    }).join('');
}

// Обновление статистики
function updateStatistics() {
    if (!currentUser) return;
    const totalStudents = students.length;
    let totalPaid = 0;
    let totalDebt = 0;
    
    students.forEach(student => {
        const paid = calculatePaidAmount(student);
        totalPaid += paid;
        totalDebt += Math.max(0, student.totalCost - paid);
    });
    
    const totalStudentsEl = document.getElementById('totalStudents');
    const paidAmountEl = document.getElementById('paidAmount');
    const debtAmountEl = document.getElementById('debtAmount');
    
    if (totalStudentsEl) totalStudentsEl.textContent = totalStudents;
    if (paidAmountEl) paidAmountEl.textContent = totalPaid.toLocaleString('ru-RU') + ' ₽';
    if (debtAmountEl) debtAmountEl.textContent = totalDebt.toLocaleString('ru-RU') + ' ₽';
}

// Фильтрация студентов
function filterStudents() {
    renderStudents();
}

// Экранирование HTML для безопасности
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Открытие модального окна отчетов
function openReportsModal() {
    if (!PERMISSIONS[currentUser.role]?.viewReports) {
        alert('У вас нет прав для просмотра отчетов');
        return;
    }
    
    renderDebtorsReport();
    renderAmountsReport();
    renderPrepaidReport();
    document.getElementById('reportsModal').classList.add('show');
}

// Закрытие модального окна отчетов
function closeReportsModal() {
    document.getElementById('reportsModal').classList.remove('show');
}

// Показ вкладки отчета
function showReportTab(tabName, button) {
    // Скрыть все вкладки
    document.querySelectorAll('.report-tab').forEach(tab => {
        tab.style.display = 'none';
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Показать выбранную вкладку
    document.getElementById(tabName + 'Report').style.display = 'block';
    
    // Активировать кнопку
    if (button) {
        button.classList.add('active');
    }
}

// Рендеринг отчета должников по специальностям
function renderDebtorsReport() {
    const container = document.getElementById('debtorsList');
    if (!container) return;
    
    const specialties = {};
    
    students.forEach(student => {
        const paid = calculatePaidAmount(student);
        const debt = Math.max(0, student.totalCost - paid);
        
        if (debt > 0) {
            const key = student.specialty && student.specialty.trim() !== '' ? student.specialty : 'Без специальности';
            if (!specialties[key]) {
                specialties[key] = { students: [], totalDebt: 0 };
            }
            specialties[key].students.push({ name: student.name, debt: debt });
            specialties[key].totalDebt += debt;
        }
    });
    
    if (Object.keys(specialties).length === 0) {
        container.innerHTML = '<p>Нет должников</p>';
        return;
    }
    
    let html = '<table class="report-table"><tr><th>Специальность</th><th>Студент</th><th>Задолженность</th></tr>';
    
    Object.keys(specialties).sort().forEach(spec => {
        specialties[spec].students.forEach((student, index) => {
            html += `
                <tr>
                    ${index === 0 ? `<td rowspan="${specialties[spec].students.length}">${escapeHtml(spec)}</td>` : ''}
                    <td>${escapeHtml(student.name)}</td>
                    <td>${student.debt.toLocaleString('ru-RU')} ₽</td>
                </tr>
            `;
        });
        html += `<tr class="group-total"><td colspan="2"><strong>Итого по специальности ${escapeHtml(spec)}:</strong></td><td><strong>${specialties[spec].totalDebt.toLocaleString('ru-RU')} ₽</strong></td></tr>`;
    });
    
    html += '</table>';
    container.innerHTML = html;
}

// Рендеринг отчета по суммам
function renderAmountsReport() {
    const container = document.getElementById('amountsList');
    if (!container) return;
    
    const firstSemester = [];
    const secondSemesterNotPaid = [];
    const fullPeriod = [];
    
    students.forEach(student => {
        const paid = calculatePaidAmount(student);
        const total = student.totalCost;
        const semesterCost = total / 2;
        const specialty = student.specialty && student.specialty.trim() !== '' ? student.specialty : 'Без специальности';
        
        if (total > 0 && semesterCost > 0) {
            const paidFirstSemester = paid >= semesterCost;
            const paidFull = paid >= total;
            const debt = Math.max(0, total - paid);

            if (paidFirstSemester) {
                firstSemester.push({
                    name: student.name,
                    specialty,
                    paidFirst: Math.min(paid, semesterCost),
                    total
                });
            }

            if (paidFirstSemester && !paidFull) {
                secondSemesterNotPaid.push({
                    name: student.name,
                    specialty,
                    debtSecond: debt
                });
            }

            if (paidFull) {
                fullPeriod.push({
                    name: student.name,
                    specialty,
                    total,
                    paid
                });
            }
        }
    });
    
    // Сортировки для удобства просмотра
    firstSemester.sort((a, b) => a.specialty.localeCompare(b.specialty, 'ru'));
    secondSemesterNotPaid.sort((a, b) => b.debtSecond - a.debtSecond);
    fullPeriod.sort((a, b) => a.specialty.localeCompare(b.specialty, 'ru'));
    
    let html = '<div class="report-section"><h4>Студенты, оплатившие 1 семестр</h4>';
    if (firstSemester.length === 0) {
        html += '<p>Нет студентов, оплативших 1 семестр</p>';
    } else {
        html += '<table class="report-table"><tr><th>Студент</th><th>Специальность</th><th>Сумма оплаты (не меньше стоимости 1 семестра)</th><th>Полная стоимость</th></tr>';
        firstSemester.forEach(s => {
            const semesterCost = s.total / 2;
            html += `<tr>
                <td>${escapeHtml(s.name)}</td>
                <td>${escapeHtml(s.specialty)}</td>
                <td>${semesterCost.toLocaleString('ru-RU')} ₽</td>
                <td>${s.total.toLocaleString('ru-RU')} ₽</td>
            </tr>`;
        });
        html += '</table>';
    }
    html += '</div>';
    
    html += '<div class="report-section"><h4>Оплачен 1 семестр, не оплачен 2 семестр</h4>';
    if (secondSemesterNotPaid.length === 0) {
        html += '<p>Нет студентов с неоплаченным 2 семестром (при оплаченном 1 семестре)</p>';
    } else {
        html += '<table class="report-table"><tr><th>Студент</th><th>Специальность</th><th>Задолженность за 2 семестр</th></tr>';
        secondSemesterNotPaid.forEach(s => {
            html += `<tr>
                <td>${escapeHtml(s.name)}</td>
                <td>${escapeHtml(s.specialty)}</td>
                <td>${s.debtSecond.toLocaleString('ru-RU')} ₽</td>
            </tr>`;
        });
        html += '</table>';
    }
    html += '</div>';

    html += '<div class="report-section"><h4>Студенты, оплатившие весь период обучения</h4>';
    if (fullPeriod.length === 0) {
        html += '<p>Нет студентов, оплативших весь период обучения</p>';
    } else {
        html += '<table class="report-table"><tr><th>Студент</th><th>Специальность</th><th>Стоимость обучения</th><th>Оплачено</th></tr>';
        fullPeriod.forEach(s => {
            html += `<tr>
                <td>${escapeHtml(s.name)}</td>
                <td>${escapeHtml(s.specialty)}</td>
                <td>${s.total.toLocaleString('ru-RU')} ₽</td>
                <td>${s.paid.toLocaleString('ru-RU')} ₽</td>
            </tr>`;
        });
        html += '</table>';
    }
    html += '</div>';
    
    container.innerHTML = html;
}

// Рендеринг отчета предоплаты
function renderPrepaidReport() {
    const container = document.getElementById('prepaidList');
    if (!container) return;
    
    const prepaid = students.filter(student => {
        const paid = calculatePaidAmount(student);
        return paid > student.totalCost;
    }).map(student => {
        const paid = calculatePaidAmount(student);
        const specialty = student.specialty && student.specialty.trim() !== '' ? student.specialty : 'Без специальности';
        return {
            name: student.name,
            specialty,
            totalCost: student.totalCost,
            paid: paid,
            prepaid: paid - student.totalCost
        };
    });
    
    if (prepaid.length === 0) {
        container.innerHTML = '<p>Нет студентов с предоплатой</p>';
        return;
    }
    
    let html = '<table class="report-table"><tr><th>Студент</th><th>Специальность</th><th>Стоимость</th><th>Оплачено</th><th>Предоплата</th></tr>';
    prepaid.forEach(p => {
        html += `
            <tr>
                <td>${escapeHtml(p.name)}</td>
                <td>${escapeHtml(p.specialty)}</td>
                <td>${p.totalCost.toLocaleString('ru-RU')} ₽</td>
                <td>${p.paid.toLocaleString('ru-RU')} ₽</td>
                <td><strong>${p.prepaid.toLocaleString('ru-RU')} ₽</strong></td>
            </tr>
        `;
    });
    html += '</table>';
    
    container.innerHTML = html;
}

// Печать отчета
function printReport(reportType) {
    const printWindow = window.open('', '_blank');
    let title = '';
    let content = '';
    
    switch(reportType) {
        case 'debtors':
            title = 'Отчет: Должники по специальностям';
            content = document.getElementById('debtorsList').innerHTML;
            break;
        case 'amounts':
            title = 'Отчет: 1 и 2 семестр / весь период обучения';
            content = document.getElementById('amountsList').innerHTML;
            break;
        case 'prepaid':
            title = 'Отчет: Студенты с предоплатой';
            content = document.getElementById('prepaidList').innerHTML;
            break;
    }
    
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${title}</title>
            <style>
                body { font-family: Arial, sans-serif; padding: 20px; }
                h1 { color: #333; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                table td, table th { border: 1px solid #ddd; padding: 8px; text-align: left; }
                table th { background-color: #f2f2f2; font-weight: bold; }
                .group-total { background-color: #f9f9f9; }
            </style>
        </head>
        <body>
            <h1>${title}</h1>
            <p>Дата формирования: ${new Date().toLocaleString('ru-RU')}</p>
            ${content}
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.print();
}

async function openAccessModal() {
    if (!PERMISSIONS[currentUser.role]?.manageUsers) {
        alert('Только директор может управлять доступами');
        return;
    }
    await loadDirectorData();
    renderAccountsList();
    renderTeacherAssignments();
    document.getElementById('accessModal').classList.add('show');
}

function closeAccessModal() {
    document.getElementById('accessModal').classList.remove('show');
}

function showAccessTab(tabName, button) {
    document.getElementById('accountsTab').style.display = tabName === 'accounts' ? 'block' : 'none';
    document.getElementById('teachersTab').style.display = tabName === 'teachers' ? 'block' : 'none';
    const tabs = document.querySelectorAll('#accessModal .tab-btn');
    tabs.forEach((t) => t.classList.remove('active'));
    if (button) button.classList.add('active');
}

async function loadDirectorData() {
    [directorUsers, teachersWithStudents] = await Promise.all([
        apiFetch('/api/director/users'),
        apiFetch('/api/director/teachers-with-students'),
    ]);
}

function roleTitle(role) {
    if (role === ROLES.STUDENT) return 'Студент';
    if (role === ROLES.TEACHER) return 'Преподаватель';
    if (role === ROLES.ACCOUNTANT) return 'Бухгалтер';
    if (role === ROLES.DIRECTOR) return 'Директор';
    return role;
}

function renderAccountsList() {
    const container = document.getElementById('accountsList');
    if (!container) return;
    if (!directorUsers.length) {
        container.innerHTML = '<p>Аккаунтов пока нет</p>';
        return;
    }

    const studentsOptions = students.map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.group)})</option>`).join('');

    container.innerHTML = directorUsers.map((u) => `
        <div class="payment-item-card" style="margin-bottom:12px;">
            <div><strong>${escapeHtml(u.fullName || u.username)}</strong> (${escapeHtml(u.email)})</div>
            <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px;">
                <select id="userRole_${u.id}">
                    <option value="student" ${u.role === 'student' ? 'selected' : ''}>Студент</option>
                    <option value="teacher" ${u.role === 'teacher' ? 'selected' : ''}>Преподаватель</option>
                    <option value="accountant" ${u.role === 'accountant' ? 'selected' : ''}>Бухгалтер</option>
                    <option value="director" ${u.role === 'director' ? 'selected' : ''}>Директор</option>
                </select>
                <select id="userStudent_${u.id}">
                    <option value="">Без привязки к студенту</option>
                    ${studentsOptions}
                </select>
                <label style="display:flex; align-items:center; gap:4px;">
                    <input type="checkbox" id="userActive_${u.id}" ${u.isActive ? 'checked' : ''}>
                    Активен
                </label>
                <button class="btn btn-primary btn-sm" onclick="saveUserAccess('${u.id}')">Сохранить доступ</button>
            </div>
            <div style="margin-top:6px; color:#666;">Текущая роль: ${roleTitle(u.role)}</div>
        </div>
    `).join('');

    directorUsers.forEach((u) => {
        const sel = document.getElementById(`userStudent_${u.id}`);
        if (sel && u.studentId) sel.value = u.studentId;
    });
}

async function saveUserAccess(userId) {
    const role = document.getElementById(`userRole_${userId}`).value;
    const studentId = document.getElementById(`userStudent_${userId}`).value || null;
    const isActive = document.getElementById(`userActive_${userId}`).checked;
    try {
        await apiFetch(`/api/director/users/${userId}/access`, {
            method: 'PATCH',
            body: JSON.stringify({ role, studentId, isActive }),
        });
        await loadDirectorData();
        renderAccountsList();
        renderTeacherAssignments();
        alert('Доступ обновлён');
    } catch (e) {
        alert(e.message || 'Ошибка сохранения доступа');
    }
}

async function createTeacher(event) {
    event.preventDefault();
    const fullName = document.getElementById('teacherFullName').value.trim();
    const email = document.getElementById('teacherEmail').value.trim();
    const password = document.getElementById('teacherPassword').value;
    try {
        await apiFetch('/api/director/teachers', {
            method: 'POST',
            body: JSON.stringify({ fullName, email, password }),
        });
        document.getElementById('createTeacherForm').reset();
        await loadDirectorData();
        renderAccountsList();
        renderTeacherAssignments();
        alert('Преподаватель добавлен');
    } catch (e) {
        alert(e.message || 'Ошибка создания преподавателя');
    }
}

function renderTeacherAssignments() {
    const container = document.getElementById('teachersAssignments');
    if (!container) return;
    if (!teachersWithStudents.length) {
        container.innerHTML = '<p>Преподаватели пока не добавлены</p>';
        return;
    }
    const studentsOptions = students.map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (${escapeHtml(s.group)})</option>`).join('');
    container.innerHTML = teachersWithStudents.map((t) => `
        <div class="payment-item-card" style="margin-bottom:12px;">
            <div><strong>${escapeHtml(t.fullName || t.username)}</strong> (${escapeHtml(t.email)})</div>
            <div style="margin:8px 0;">Закреплённые студенты: ${t.students.length ? t.students.map((s) => escapeHtml(s.name)).join(', ') : 'нет'}</div>
            <select id="teacherStudents_${t.id}" multiple style="min-height:120px; width:100%;">
                ${studentsOptions}
            </select>
            <div class="form-actions">
                <button class="btn btn-primary btn-sm" onclick="saveTeacherStudents('${t.id}')">Сохранить закрепления</button>
            </div>
        </div>
    `).join('');

    teachersWithStudents.forEach((t) => {
        const select = document.getElementById(`teacherStudents_${t.id}`);
        if (!select) return;
        const assigned = new Set(t.students.map((s) => s.id));
        Array.from(select.options).forEach((opt) => {
            opt.selected = assigned.has(opt.value);
        });
    });
}

async function saveTeacherStudents(teacherId) {
    const select = document.getElementById(`teacherStudents_${teacherId}`);
    const studentIds = Array.from(select.selectedOptions).map((o) => o.value);
    try {
        await apiFetch(`/api/director/teachers/${teacherId}/students`, {
            method: 'PUT',
            body: JSON.stringify({ studentIds }),
        });
        await loadDirectorData();
        renderTeacherAssignments();
        alert('Закрепления сохранены');
    } catch (e) {
        alert(e.message || 'Ошибка сохранения закреплений');
    }
}

// Закрытие модальных окон при клике вне их
window.onclick = function(event) {
    const studentModal = document.getElementById('studentModal');
    const paymentModal = document.getElementById('paymentModal');
    const studentCardModal = document.getElementById('studentCardModal');
    const reportsModal = document.getElementById('reportsModal');
    const accessModal = document.getElementById('accessModal');
    const loginModal = document.getElementById('loginModal');
    
    if (event.target === studentModal) {
        closeStudentModal();
    }
    if (event.target === paymentModal) {
        closePaymentModal();
    }
    if (event.target === studentCardModal) {
        closeStudentCardModal();
    }
    if (event.target === reportsModal) {
        closeReportsModal();
    }
    if (event.target === accessModal) {
        closeAccessModal();
    }
    if (event.target === loginModal) {
        // Не закрываем окно авторизации при клике вне его
    }
}
