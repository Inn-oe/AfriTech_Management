import { Component } from 'react';

/** Shows a message instead of a blank page when a screen fails to draw. Remount it (change `key`) to clear the error. */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Screen failed to draw', error, info?.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="alert alert-danger m-4" role="alert">
        <div className="fw-semibold mb-1"><i className="fas fa-triangle-exclamation me-2" />Something went wrong showing this page.</div>
        <div className="small mb-3">Your data is safe. Reload the page, or go back to the dashboard.</div>
        <button type="button" className="btn btn-sm btn-danger me-2" onClick={() => window.location.reload()}>Reload page</button>
        <a className="btn btn-sm btn-outline-danger" href="/">Go to dashboard</a>
      </div>
    );
  }
}
