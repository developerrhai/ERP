// 404 / 403 card for unknown routes, unknown page ids and pages the user may not open.
import { Link } from 'react-router-dom';

interface Props {
  title?: string;
  message?: string;
}

export function NotFoundPage({
  title = 'Page not found',
  message = 'The page you asked for does not exist or is not available to your account.',
}: Props) {
  return (
    <div className="card panel card-404" role="region" aria-labelledby="nf-title">
      <h1 id="nf-title">{title}</h1>
      <p>{message}</p>
      <Link className="btn primary" to="/">
        Go to Dashboard
      </Link>
    </div>
  );
}
