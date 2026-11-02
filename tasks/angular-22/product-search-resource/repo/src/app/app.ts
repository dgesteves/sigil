import { Component } from '@angular/core';
import { ProductSearch } from './catalog/product-search';

@Component({
  selector: 'app-root',
  imports: [ProductSearch],
  template: '<h1>Products</h1><app-product-search />',
})
export class App {}
