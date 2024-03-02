# @globalworldwide/grpc-resolvers

Custom resolvers for @grpc/grpc-js

## K8SResolver

## FixedResolver

## Register Resolvers with @grpc/grpc-js

```javascript
import { experimental } from '@grpc/grpc-js'
import { FixedResolver, K8SResolver } from '@globalworldwide/grpc-resolvers'

experimental.registerResolver('fixed', FixedResolver)
experimental.registerResolver('k8s', K8SResolver)
```

## Tracing
```bash
export GRPC_TRACE=fixed-resolver,k8s-resolver
export GRPC_VERBOSITY=debug
```
