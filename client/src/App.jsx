import { Navigate, Route, Routes } from 'react-router-dom';

import Layout from './components/Layout.jsx';
import { useAuth } from './context/AuthContext.jsx';
import { SocketProvider } from './context/SocketContext.jsx';
import Account from './pages/Account.jsx';
import Assistant from './pages/Assistant.jsx';
import DetailedSearch from './pages/DetailedSearch.jsx';
import Faq from './pages/Faq.jsx';
import Guide from './pages/Guide.jsx';
import Home from './pages/Home.jsx';
import Login from './pages/Login.jsx';
import QuickSearch from './pages/QuickSearch.jsx';

/**
 * The gate. Until the server says who you are, nothing but the login page is
 * shown, and nothing else is even mounted (so no live connection, no requests
 * for data, until someone has signed in).
 */
export default function App({ pollMs }) {
  const { status } = useAuth();

  if (status === 'loading') return <div className="login-page" aria-busy="true" />;
  if (status === 'out') return <Login />;

  return (
    <SocketProvider pollMs={pollMs}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="assistant" element={<Assistant />} />
          <Route path="search" element={<DetailedSearch />} />
          <Route path="quick-search" element={<QuickSearch />} />
          <Route path="account" element={<Account />} />
          <Route path="guide" element={<Guide />} />
          <Route path="faq" element={<Faq />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </SocketProvider>
  );
}
