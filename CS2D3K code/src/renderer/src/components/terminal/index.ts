// Side-effect entry: registers the terminal/output commands and starts collecting `run-output`
// events. Import once at app start (e.g. from Shell) so they work before the bottom panel loads.
import './output'
import './registry'
