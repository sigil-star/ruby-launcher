import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../lib/i18n";

type Props = { children: ReactNode; resetKey?: string; onHome?: () => void };
type State = { error: Error | null };

/** Keeps one broken page from blanking the whole window: the rest of Ruby keeps working. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("page crashed", error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page crash-card">
        <h2>{t("Something went wrong on this page")}</h2>
        <p className="muted">{t("The rest of Ruby is fine. Try again, or go back home.")}</p>
        <p className="muted small mono">{this.state.error.message.slice(0, 200)}</p>
        <div className="crash-actions">
          <button className="btn btn-primary btn-small" onClick={() => this.setState({ error: null })}>
            {t("Try again")}
          </button>
          {this.props.onHome ? (
            <button className="btn btn-secondary btn-small" onClick={this.props.onHome}>
              {t("Go home")}
            </button>
          ) : null}
        </div>
      </div>
    );
  }
}
