import { NavLink } from 'react-router-dom';

export default function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <NavLink to="/" className="navbar-brand">
          <span className="emoji">🧠</span>
          ExpressCoach
        </NavLink>
        <ul className="navbar-links">
          <li>
            <NavLink to="/analyze" className={({ isActive }) => isActive ? 'active' : ''}>
              🔍 分析
            </NavLink>
          </li>
          <li>
            <NavLink to="/sandbox" className={({ isActive }) => isActive ? 'active' : ''}>
              🎮 练习
            </NavLink>
          </li>
          <li>
            <NavLink to="/surveys" className={({ isActive }) => isActive ? 'active' : ''}>
              📝 问卷
            </NavLink>
          </li>
          <li>
            <NavLink to="/tests" className={({ isActive }) => isActive ? 'active' : ''}>
              🧪 测试
            </NavLink>
          </li>
          <li>
            <NavLink to="/dashboard" className={({ isActive }) => isActive ? 'active' : ''}>
              📊 数据
            </NavLink>
          </li>
        </ul>
      </div>
    </nav>
  );
}
