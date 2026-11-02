import { Component } from '@angular/core';
import { DispatchBoard } from './board/dispatch-board';

@Component({
  selector: 'app-root',
  imports: [DispatchBoard],
  template: '<h1>Dispatch</h1><app-dispatch-board />',
})
export class App {}
